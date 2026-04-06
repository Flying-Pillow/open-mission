import { startDaemon } from './Daemon.js';
import { resolveGitWorkspaceRoot } from '../lib/workspacePaths.js';
import type { AgentRunner } from '../runtime/AgentRunner.js';

type RuntimeFactoryModule = {
	createConfiguredAgentRunners?: (options: {
		controlRoot: string;
		logLine?: (line: string) => void;
	}) => Promise<AgentRunner[]> | AgentRunner[];
};

function writeDaemonLogLine(line: string): void {
	process.stdout.write(`[Mission daemon ${new Date().toISOString()}] ${line}\n`);
}

function readSocketPathFromArgv(argv: string[]): string | undefined {
	const socketFlagIndex = argv.indexOf('--socket');
	if (socketFlagIndex < 0) {
		return undefined;
	}

	return argv[socketFlagIndex + 1];
}

async function loadConfiguredAgentRunners(logLine?: (line: string) => void): Promise<AgentRunner[]> {
	const modulePath = process.env['MISSION_RUNTIME_FACTORY_MODULE']?.trim();
	if (!modulePath) {
		return [];
	}
	const surfacePath = process.env['MISSION_SURFACE_PATH']?.trim() || process.cwd();
	const controlRoot = resolveGitWorkspaceRoot(surfacePath) ?? surfacePath;

	const loadedModule = (await import(modulePath)) as RuntimeFactoryModule;
	if (typeof loadedModule.createConfiguredAgentRunners !== 'function') {
		throw new Error(
			`Mission runtime factory module '${modulePath}' does not export createConfiguredAgentRunners(...).`
		);
	}

	return await loadedModule.createConfiguredAgentRunners({
		controlRoot,
		...(logLine ? { logLine } : {})
	});
}

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const socketPath = readSocketPathFromArgv(argv);
	const logLine = writeDaemonLogLine;
	const runners = await loadConfiguredAgentRunners(logLine);
	const daemon = await startDaemon({
		logLine,
		runners,
		...(socketPath ? { socketPath } : {})
	});

	logLine(`Listening on ${daemon.getManifest()?.endpoint.path ?? 'unknown socket'}.`);
	process.stdout.write(`${JSON.stringify(daemon.getManifest(), null, 2)}\n`);

	const stopDaemon = async () => {
		logLine('Shutdown requested.');
		await daemon.close();
	};

	process.once('SIGINT', () => {
		void stopDaemon();
	});
	process.once('SIGTERM', () => {
		void stopDaemon();
	});

	await daemon.waitUntilClosed();
}
