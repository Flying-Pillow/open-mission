import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DaemonClient,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	readDaemonManifest,
	type Ping
} from '@flying-pillow/mission-core';

export type MissiondCommand = 'start' | 'stop' | 'restart' | 'status' | 'run';

export type MissionDaemonLaunchMode = 'build' | 'source';

export type DaemonStatusResult = {
	manifestPath: string;
	running: boolean;
	message: string;
	pid?: number;
	startedAt?: string;
	endpointPath?: string;
	protocolVersion?: number;
};

export type DaemonStartResult = DaemonStatusResult & {
	started: boolean;
	alreadyRunning: boolean;
};

export type DaemonStopResult = {
	stopped: boolean;
	manifestPath: string;
	endpointPath?: string;
	pid?: number;
	killed: boolean;
	message: string;
};

export async function getMissionDaemonStatus(): Promise<DaemonStatusResult> {
	const manifestPath = getDaemonManifestPath();
	const manifest = await readDaemonManifest();
	if (!manifest) {
		return {
			manifestPath,
			running: false,
			message: 'Mission daemon is not running.'
		};
	}

	const client = new DaemonClient();
	try {
		await client.connect({ surfacePath: process.cwd(), socketPath: manifest.endpoint.path });
		const ping = await client.request<Ping>('ping');
		return {
			manifestPath,
			running: true,
			message: 'Mission daemon is running.',
			pid: ping.pid,
			startedAt: ping.startedAt,
			endpointPath: manifest.endpoint.path,
			protocolVersion: ping.protocolVersion
		};
	} catch (error) {
		return {
			manifestPath,
			running: false,
			message: `Mission daemon manifest exists but is unreachable: ${error instanceof Error ? error.message : String(error)}`,
			pid: manifest.pid,
			startedAt: manifest.startedAt,
			endpointPath: manifest.endpoint.path,
			protocolVersion: manifest.protocolVersion
		};
	} finally {
		client.dispose();
	}
}

export async function startMissionDaemon(options: {
	socketPath?: string;
	surfacePath?: string;
	launchMode?: MissionDaemonLaunchMode;
	runtimeFactoryModulePath?: string;
}): Promise<DaemonStartResult> {
	const currentStatus = await getMissionDaemonStatus();
	if (currentStatus.running) {
		return {
			...currentStatus,
			started: false,
			alreadyRunning: true
		};
	}

	const child = spawnMissionDaemonRunner(options);
	child.unref();
	const timeoutAt = Date.now() + 15_000;
	let latestStatus = currentStatus;
	while (Date.now() < timeoutAt) {
		await new Promise((resolve) => setTimeout(resolve, 150));
		latestStatus = await getMissionDaemonStatus();
		if (latestStatus.running) {
			return {
				...latestStatus,
				started: true,
				alreadyRunning: false
			};
		}
	}

	throw new Error(`Mission daemon did not become ready: ${latestStatus.message}`);
}

export async function stopMissionDaemon(): Promise<DaemonStopResult> {
	const manifestPath = getDaemonManifestPath();
	const manifest = await readDaemonManifest();

	if (!manifest) {
		return {
			stopped: true,
			manifestPath,
			killed: false,
			message: 'Mission daemon is already stopped.'
		};
	}

	let killed = false;
	try {
		process.kill(manifest.pid, 'SIGTERM');
		killed = true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ESRCH') {
			throw error;
		}
	}

	await fs.rm(manifestPath, { force: true }).catch(() => undefined);
	if (manifest.endpoint.transport === 'ipc') {
		await fs.rm(manifest.endpoint.path, { force: true }).catch(() => undefined);
	}
	await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);

	return {
		stopped: true,
		manifestPath,
		endpointPath: manifest.endpoint.path,
		pid: manifest.pid,
		killed,
		message: killed
			? 'Mission daemon stop signal sent and runtime files cleaned.'
			: 'Mission daemon runtime files cleaned; process was not running.'
	};
}

function spawnMissionDaemonRunner(options: {
	socketPath?: string;
	surfacePath?: string;
	launchMode?: MissionDaemonLaunchMode;
	runtimeFactoryModulePath?: string;
}) {
	const cliRoot = resolveCliPackageRoot();
	const launchMode =
		options.launchMode ?? (process.env['MISSION_DAEMON_LAUNCH_MODE']?.trim() || 'build');
	const socketArgs = options.socketPath ? ['--socket', options.socketPath] : [];
	const sourceEntry = path.join(cliRoot, 'src', 'daemon.ts');
	const buildEntry = path.join(cliRoot, 'build', 'daemon.js');
	const env = {
		...process.env,
		...(options.surfacePath ? { MISSION_SURFACE_PATH: options.surfacePath } : {}),
		MISSION_DAEMON_LAUNCH_MODE: launchMode,
		...(options.runtimeFactoryModulePath
			? { MISSION_RUNTIME_FACTORY_MODULE: options.runtimeFactoryModulePath }
			: {})
	};

	if (launchMode === 'source') {
		return spawn(
			'pnpm',
			['--dir', cliRoot, 'exec', 'tsx', sourceEntry, 'run', ...socketArgs],
			{
				cwd: cliRoot,
				env,
				stdio: ['ignore', 'inherit', 'inherit'],
				detached: true,
				windowsHide: true
			}
		);
	}

	return spawn(process.execPath, [buildEntry, 'run', ...socketArgs], {
		cwd: cliRoot,
		env,
		stdio: ['ignore', 'inherit', 'inherit'],
		detached: true,
		windowsHide: true
	});
}

function resolveCliPackageRoot(): string {
	const currentFilePath = fileURLToPath(import.meta.url);
	return path.resolve(path.dirname(currentFilePath), '..', '..');
}
