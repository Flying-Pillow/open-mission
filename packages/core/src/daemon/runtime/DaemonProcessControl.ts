import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../client/DaemonClient.js';
import type { Ping } from '../protocol/contracts.js';
import {
	getDaemonLockPath,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	getDaemonStdoutLogPath,
	isNamedPipePath,
	readDaemonManifest,
	resolveDaemonSocketPath
} from '../daemonPaths.js';

const execFileAsync = promisify(execFile);
const DAEMON_STATUS_TIMEOUT_MS = 2_000;
const DAEMON_STALE_PROCESS_TIMEOUT_MS = 2_000;

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

export async function getOpenMissionDaemonProcessStatus(): Promise<DaemonStatusResult> {
	const manifestPath = getDaemonManifestPath();
	const manifest = await readDaemonManifest();
	if (!manifest) {
		return {
			manifestPath,
			running: false,
			message: 'Open Mission daemon is not running.'
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
			message: 'Open Mission daemon is running.',
			pid: ping.pid,
			startedAt: ping.startedAt,
			endpointPath: manifest.endpoint.path,
			protocolVersion: ping.protocolVersion
		};
	} catch (error) {
		return {
			manifestPath,
			running: false,
			message: `Open Mission daemon manifest exists but is unreachable: ${error instanceof Error ? error.message : String(error)}`,
			pid: manifest.pid,
			startedAt: manifest.startedAt,
			endpointPath: manifest.endpoint.path,
			protocolVersion: manifest.protocolVersion
		};
	} finally {
		client.dispose();
	}
}

export async function startOpenMissionDaemonProcess(options: {
	socketPath?: string;
	surfacePath?: string;
	runtimeMode?: DaemonRuntimeMode;
}): Promise<DaemonStartResult> {
	let currentStatus = await getOpenMissionDaemonProcessStatus();
	if (currentStatus.running) {
		return {
			...currentStatus,
			started: false,
			alreadyRunning: true
		};
	}
	currentStatus = await cleanupUnreachableDaemonRuntime(currentStatus);
	if (currentStatus.running) {
		return {
			...currentStatus,
			started: false,
			alreadyRunning: true
		};
	}

	const child = await spawnDaemonAdapter(options);
	child.unref();
	const timeoutAt = Date.now() + 15_000;
	let latestStatus = currentStatus;
	while (Date.now() < timeoutAt) {
		await new Promise((resolve) => setTimeout(resolve, 150));
		latestStatus = await getOpenMissionDaemonProcessStatus();
		if (latestStatus.running) {
			return {
				...latestStatus,
				started: true,
				alreadyRunning: false
			};
		}
	}

	throw new Error(`Open Mission daemon did not become ready: ${latestStatus.message}`);
}

export async function stopOpenMissionDaemonProcess(): Promise<DaemonStopResult> {
	const manifestPath = getDaemonManifestPath();
	const manifest = await readDaemonManifest();
	const staleProcessIds = await listOpenMissionDaemonProcessIds();

	if (!manifest && staleProcessIds.length === 0) {
		return {
			stopped: true,
			manifestPath,
			killed: false,
			message: 'Open Mission daemon is already stopped.'
		};
	}

	let killed = false;
	const processIdsToStop = new Set<number>([
		...(manifest ? [manifest.pid] : []),
		...staleProcessIds
	]);
	for (const processId of processIdsToStop) {
		killed = await terminateDaemonProcess(processId) || killed;
	}

	await cleanupDaemonRuntimeFilesIfUnreachable(manifest?.endpoint.path);

	return {
		stopped: true,
		manifestPath,
		...(manifest?.endpoint.path ? { endpointPath: manifest.endpoint.path } : {}),
		...(manifest?.pid ? { pid: manifest.pid } : {}),
		killed,
		message: killed
			? 'Open Mission daemon stop signal sent and control files cleaned.'
			: 'Open Mission daemon control files cleaned; process was not running.'
	};
}

async function cleanupUnreachableDaemonRuntime(
	currentStatus: DaemonStatusResult
): Promise<DaemonStatusResult> {
	const manifest = await readDaemonManifest();
	const staleProcessIds = new Set<number>([
		...(manifest?.pid ? [manifest.pid] : []),
		...(currentStatus.pid ? [currentStatus.pid] : []),
		...(await listOpenMissionDaemonProcessIds())
	]);

	for (const processId of staleProcessIds) {
		await terminateDaemonProcess(processId);
	}

	await cleanupDaemonRuntimeFilesIfUnreachable(manifest?.endpoint.path ?? currentStatus.endpointPath);
	return getOpenMissionDaemonProcessStatus();
}

async function cleanupDaemonRuntimeFilesIfUnreachable(endpointPath: string | undefined): Promise<void> {
	const currentStatus = await getOpenMissionDaemonProcessStatus();
	if (currentStatus.running) {
		return;
	}

	const socketPath = endpointPath?.trim() || resolveDaemonSocketPath();
	if (await isDaemonEndpointReachable(socketPath)) {
		return;
	}

	await fs.rm(getDaemonManifestPath(), { force: true }).catch(() => undefined);
	await fs.rm(getDaemonLockPath(), { force: true }).catch(() => undefined);
	if (!isNamedPipePath(socketPath)) {
		await fs.rm(socketPath, { force: true }).catch(() => undefined);
	}
}

async function isDaemonEndpointReachable(socketPath: string): Promise<boolean> {
	const client = new DaemonClient();
	try {
		await client.connect({
			surfacePath: process.cwd(),
			socketPath,
			timeoutMs: DAEMON_STATUS_TIMEOUT_MS
		});
		await client.request<Ping>('ping', undefined, { timeoutMs: DAEMON_STATUS_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	} finally {
		client.dispose();
	}
}

async function terminateDaemonProcess(processId: number): Promise<boolean> {
	if (processId === process.pid || !isProcessRunning(processId)) {
		return false;
	}

	try {
		process.kill(processId, 'SIGTERM');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			throw error;
		}
		return false;
	}

	const exited = await waitForProcessExit(processId, DAEMON_STALE_PROCESS_TIMEOUT_MS);
	if (exited) {
		return true;
	}

	try {
		process.kill(processId, 'SIGKILL');
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			throw error;
		}
		return true;
	}
}

async function waitForProcessExit(processId: number, timeoutMs: number): Promise<boolean> {
	const timeoutAt = Date.now() + timeoutMs;
	while (Date.now() < timeoutAt) {
		if (!isProcessRunning(processId)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !isProcessRunning(processId);
}

function isProcessRunning(processId: number): boolean {
	try {
		process.kill(processId, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

async function spawnDaemonAdapter(options: {
	socketPath?: string;
	surfacePath?: string;
	runtimeMode?: DaemonRuntimeMode;
}) {
	const packageRoot = resolveCorePackageRoot();
	const runtimeMode =
		options.runtimeMode ?? (process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build');
	const socketArgs = options.socketPath ? ['--socket', options.socketPath] : [];
	const sourceEntry = path.join(packageRoot, 'src', 'daemon', 'open-missiond.ts');
	const buildEntry = path.join(packageRoot, 'build', 'daemon', 'open-missiond.js');
	const daemonWorkingDirectory = options.surfacePath?.trim() || packageRoot;
	const env = {
		...process.env,
		OPEN_MISSION_DAEMON_RUNTIME_MODE: runtimeMode,
		...(runtimeMode === 'source'
			? { NODE_OPTIONS: appendNodeCondition(process.env['NODE_OPTIONS'], 'typescript') }
			: {})
	};
	await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
	const daemonLogPath = getDaemonStdoutLogPath();
	const daemonLogFd = fsSync.openSync(daemonLogPath, 'a');
	const stdio: [number | 'ignore', number, number] = ['ignore', daemonLogFd, daemonLogFd];

	if (runtimeMode === 'source') {
		const child = spawn(
			'pnpm',
			['--dir', packageRoot, 'exec', 'tsx', '--tsconfig', path.join(packageRoot, 'tsconfig.json'), sourceEntry, 'run', ...socketArgs],
			{
				cwd: daemonWorkingDirectory,
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
		cwd: daemonWorkingDirectory,
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
		const resolvedPackageEntry = require.resolve('@flying-pillow/open-mission-core');
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

async function listOpenMissionDaemonProcessIds(): Promise<number[]> {
	if (process.platform === 'win32') {
		return [];
	}

	try {
		const result = await execFileAsync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
		return result.stdout
			.split(/\r?\n/gu)
			.map((line) => line.trim())
			.filter((line) => line.includes('/packages/core/build/daemon/open-missiond.js run') || line.includes('/packages/core/src/daemon/open-missiond.ts run'))
			.map((line) => Number.parseInt(line.split(/\s+/u, 1)[0] ?? '', 10))
			.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
	} catch {
		return [];
	}
}