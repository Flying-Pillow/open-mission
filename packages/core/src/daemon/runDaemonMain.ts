import type { MissionAgentRuntime } from './MissionAgentRuntime.js';
import { startDaemon } from './Daemon.js';
import { resolveGitWorkspaceRoot } from '../lib/workspacePaths.js';

type RuntimeFactoryModule = {
	createConfiguredMissionRuntimes?: (options: {
		controlRoot: string;
		logLine?: (line: string) => void;
	}) => Promise<MissionAgentRuntime[]> | MissionAgentRuntime[];
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

async function loadConfiguredRuntimes(logLine?: (line: string) => void): Promise<MissionAgentRuntime[]> {
	const modulePath = process.env['MISSION_RUNTIME_FACTORY_MODULE']?.trim();
	if (!modulePath) {
		return [];
	}
	const surfacePath = process.env['MISSION_SURFACE_PATH']?.trim() || process.cwd();
	const controlRoot = resolveGitWorkspaceRoot(surfacePath) ?? surfacePath;

	const loadedModule = (await import(modulePath)) as RuntimeFactoryModule;
	if (typeof loadedModule.createConfiguredMissionRuntimes !== 'function') {
		throw new Error(
			`Mission runtime factory module '${modulePath}' does not export createConfiguredMissionRuntimes(...).`
		);
	}

	return await loadedModule.createConfiguredMissionRuntimes({
		controlRoot,
		...(logLine ? { logLine } : {})
	});
}

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const socketPath = readSocketPathFromArgv(argv);
	const logLine = writeDaemonLogLine;
	const runtimes = await loadConfiguredRuntimes(logLine);
	const daemon = await startDaemon({
		logLine,
		runtimes,
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
