import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../../client/DaemonClient.js';
import type { Ping } from '../protocol/transport.js';
import {
	getDaemonManifestPath,
	getDaemonRuntimePath,
	getDaemonStdoutLogPath,
	readDaemonManifest
} from '../daemonPaths.js';

const execFileAsync = promisify(execFile);
const DAEMON_STATUS_TIMEOUT_MS = 2_000;

export type DaemonRuntimeMode = 'build' | 'source';

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

export async function getMissionDaemonProcessStatus(): Promise<DaemonStatusResult> {
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
		await client.connect({
			surfacePath: process.cwd(),
			socketPath: manifest.endpoint.path,
			timeoutMs: DAEMON_STATUS_TIMEOUT_MS
		});
		const ping = await client.request<Ping>('ping', undefined, {
			timeoutMs: DAEMON_STATUS_TIMEOUT_MS
		});
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

export async function startMissionDaemonProcess(options: {
	socketPath?: string;
	surfacePath?: string;
	runtimeMode?: DaemonRuntimeMode;
	runtimeFactoryModulePath?: string;
}): Promise<DaemonStartResult> {
	const currentStatus = await getMissionDaemonProcessStatus();
	if (currentStatus.running) {
		return {
			...currentStatus,
			started: false,
			alreadyRunning: true
		};
	}

	const child = await spawnDaemonRunner(options);
	child.unref();
	const timeoutAt = Date.now() + 15_000;
	let latestStatus = currentStatus;
	while (Date.now() < timeoutAt) {
		await new Promise((resolve) => setTimeout(resolve, 150));
		latestStatus = await getMissionDaemonProcessStatus();
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

export async function stopMissionDaemonProcess(): Promise<DaemonStopResult> {
	const manifestPath = getDaemonManifestPath();
	const manifest = await readDaemonManifest();
	const staleProcessIds = await listMissionDaemonProcessIds();

	if (!manifest && staleProcessIds.length === 0) {
		return {
			stopped: true,
			manifestPath,
			killed: false,
			message: 'Mission daemon is already stopped.'
		};
	}

	let killed = false;
	const processIdsToStop = new Set<number>([
		...(manifest ? [manifest.pid] : []),
		...staleProcessIds
	]);
	for (const processId of processIdsToStop) {
		try {
			process.kill(processId, 'SIGTERM');
			killed = true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'ESRCH') {
				throw error;
			}
		}
	}

	await fs.rm(manifestPath, { force: true }).catch(() => undefined);
	if (manifest?.endpoint.transport === 'ipc') {
		await fs.rm(manifest.endpoint.path, { force: true }).catch(() => undefined);
	}
	await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);

	return {
		stopped: true,
		manifestPath,
		...(manifest?.endpoint.path ? { endpointPath: manifest.endpoint.path } : {}),
		...(manifest?.pid ? { pid: manifest.pid } : {}),
		killed,
		message: killed
			? 'Mission daemon stop signal sent and runtime files cleaned.'
			: 'Mission daemon runtime files cleaned; process was not running.'
	};
}

export function resolveDefaultRuntimeFactoryModulePath(
	runtimeMode: DaemonRuntimeMode
): string | undefined {
	const packageRoot = resolveCorePackageRoot();
	const sourcePath = path.join(packageRoot, 'src', 'daemon', 'runtime', 'agent', 'runtimes', 'AgentRuntimeFactory.ts');
	const buildPath = path.join(packageRoot, 'build', 'daemon', 'runtime', 'agent', 'runtimes', 'AgentRuntimeFactory.js');

	if (runtimeMode === 'source' && fsSync.existsSync(sourcePath)) {
		return sourcePath;
	}

	if (runtimeMode === 'build' && fsSync.existsSync(buildPath)) {
		return buildPath;
	}

	if (fsSync.existsSync(buildPath)) {
		return buildPath;
	}

	if (fsSync.existsSync(sourcePath)) {
		return sourcePath;
	}

	return undefined;
}

async function spawnDaemonRunner(options: {
	socketPath?: string;
	surfacePath?: string;
	runtimeMode?: DaemonRuntimeMode;
	runtimeFactoryModulePath?: string;
}) {
	const packageRoot = resolveCorePackageRoot();
	const runtimeMode =
		options.runtimeMode ?? (process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build');
	const socketArgs = options.socketPath ? ['--socket', options.socketPath] : [];
	const sourceEntry = path.join(packageRoot, 'src', 'daemon', 'missiond.ts');
	const buildEntry = path.join(packageRoot, 'build', 'daemon', 'missiond.js');
	const env = {
		...process.env,
		...(options.surfacePath ? { MISSION_SURFACE_PATH: options.surfacePath } : {}),
		MISSION_DAEMON_RUNTIME_MODE: runtimeMode,
		...(runtimeMode === 'source'
			? { NODE_OPTIONS: appendNodeCondition(process.env['NODE_OPTIONS'], 'typescript') }
			: {}),
		...(options.runtimeFactoryModulePath
			? { MISSION_RUNTIME_FACTORY_MODULE: options.runtimeFactoryModulePath }
			: {})
	};
	await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
	const daemonLogPath = getDaemonStdoutLogPath();
	const daemonLogFd = fsSync.openSync(daemonLogPath, 'a');
	const stdio: [number | 'ignore', number, number] = ['ignore', daemonLogFd, daemonLogFd];

	if (runtimeMode === 'source') {
		const child = spawn(
			'pnpm',
			['--dir', packageRoot, 'exec', 'tsx', sourceEntry, 'run', ...socketArgs],
			{
				cwd: packageRoot,
				env,
				stdio,
				detached: true,
				windowsHide: true
			}
		);
		fsSync.closeSync(daemonLogFd);
		return child;
	}

	const child = spawn(process.execPath, [buildEntry, 'run', ...socketArgs], {
		cwd: packageRoot,
		env,
		stdio,
		detached: true,
		windowsHide: true
	});
	fsSync.closeSync(daemonLogFd);
	return child;
}

function resolveCorePackageRoot(): string {
	try {
		const require = createRequire(import.meta.url);
		const resolvedPackageEntry = require.resolve('@flying-pillow/mission-core');
		return path.resolve(resolvedPackageEntry, '..', '..');
	} catch {
		// Fall back to the local source layout when package resolution is unavailable.
	}

	const currentFilePath = fileURLToPath(import.meta.url);
	return path.resolve(path.dirname(currentFilePath), '..', '..');
}

function appendNodeCondition(existingOptions: string | undefined, condition: string): string {
	const nextFlag = `--conditions=${condition}`;
	if (!existingOptions || existingOptions.trim().length === 0) {
		return nextFlag;
	}
	if (existingOptions.includes(nextFlag)) {
		return existingOptions;
	}
	return `${existingOptions} ${nextFlag}`;
}

async function listMissionDaemonProcessIds(): Promise<number[]> {
	if (process.platform === 'win32') {
		return [];
	}

	try {
		const result = await execFileAsync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
		return result.stdout
			.split(/\r?\n/gu)
			.map((line) => line.trim())
			.filter((line) => line.includes('/packages/core/build/daemon/missiond.js run') || line.includes('/packages/core/src/daemon/missiond.ts run'))
			.map((line) => Number.parseInt(line.split(/\s+/u, 1)[0] ?? '', 10))
			.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
	} catch {
		return [];
	}
}