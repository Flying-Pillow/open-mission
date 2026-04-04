import { getRepoRoot } from '../lib/repoPaths.js';
import type { MissionAgentRuntime } from './MissionAgentRuntime.js';
import { startDaemon } from './Daemon.js';

type RuntimeFactoryModule = {
	createConfiguredMissionRuntimes?: (options: {
		repoRoot: string;
		logLine?: (line: string) => void;
	}) => Promise<MissionAgentRuntime[]> | MissionAgentRuntime[];
};

function readSocketPathFromArgv(argv: string[]): string | undefined {
	const socketFlagIndex = argv.indexOf('--socket');
	if (socketFlagIndex < 0) {
		return undefined;
	}

	return argv[socketFlagIndex + 1];
}

async function loadConfiguredRuntimes(repoRoot: string): Promise<MissionAgentRuntime[]> {
	const modulePath = process.env['MISSION_RUNTIME_FACTORY_MODULE']?.trim();
	if (!modulePath) {
		return [];
	}

	const loadedModule = (await import(modulePath)) as RuntimeFactoryModule;
	if (typeof loadedModule.createConfiguredMissionRuntimes !== 'function') {
		throw new Error(
			`Mission runtime factory module '${modulePath}' does not export createConfiguredMissionRuntimes(...).`
		);
	}

	return await loadedModule.createConfiguredMissionRuntimes({ repoRoot });
}

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const repoRoot = process.env['MISSION_REPO_ROOT']?.trim() || getRepoRoot();
	const socketPath = readSocketPathFromArgv(argv);
	const runtimes = await loadConfiguredRuntimes(repoRoot);
	const daemon = await startDaemon({
		repoRoot,
		runtimes,
		...(socketPath ? { socketPath } : {})
	});

	process.stdout.write(`${JSON.stringify(daemon.getManifest(), null, 2)}\n`);

	const stopDaemon = async () => {
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
