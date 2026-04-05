import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolveDaemonSocketPath } from '../daemon/daemonPaths.js';
import { PROTOCOL_VERSION, type Ping } from '../daemon/protocol.js';
import { DaemonClient } from './DaemonClient.js';

export type DaemonLaunchMode = 'build' | 'source';

export type ConnectDaemonClientOptions = {
	surfacePath: string;
	socketPath?: string;
	preferredLaunchMode?: DaemonLaunchMode;
	startupTimeoutMs?: number;
	logLine?: (line: string) => void;
	runtimeFactoryModulePath?: string;
};

type DaemonStartCommand = {
	command: string;
	args: string[];
	launchMode: DaemonLaunchMode;
	shell?: boolean;
};

class IncompatibleDaemonError extends Error {
	public constructor(
		public readonly pid: number | undefined,
		public readonly protocolVersion: number | undefined
	) {
		super(
			`Mission daemon protocol ${String(protocolVersion ?? 'unknown')} is incompatible with client protocol ${String(PROTOCOL_VERSION)}.`
		);
		this.name = 'IncompatibleDaemonError';
	}
}

export function resolveDaemonLaunchModeFromModule(
	moduleUrl: string | URL
): DaemonLaunchMode {
	const modulePath = fileURLToPath(moduleUrl);
	return modulePath.includes(`${path.sep}src${path.sep}`) ? 'source' : 'build';
}

export async function connectDaemonClient(
	options: ConnectDaemonClientOptions
): Promise<DaemonClient> {
	const immediateClient = new DaemonClient();
	try {
		await immediateClient.connect({
			surfacePath: options.surfacePath,
			...(options.socketPath ? { socketPath: options.socketPath } : {})
		});
		await ensureCompatibleDaemon(immediateClient);
		return immediateClient;
	} catch (error) {
		immediateClient.dispose();
		await stopIncompatibleDaemon(error, options);
	}

	await startDaemonProcess(options);

	const timeoutAt = Date.now() + (options.startupTimeoutMs ?? 15000);
	let lastError: Error | undefined;
	while (Date.now() < timeoutAt) {
		const retryClient = new DaemonClient();
		try {
			await retryClient.connect({
				surfacePath: options.surfacePath,
				...(options.socketPath ? { socketPath: options.socketPath } : {})
			});
			await ensureCompatibleDaemon(retryClient);
			return retryClient;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			retryClient.dispose();
			await stopIncompatibleDaemon(error, options);
			await delay(150);
		}
	}

	throw new Error(
		lastError
			? `Mission daemon did not become ready: ${lastError.message}`
			: 'Mission daemon did not become ready.'
	);
}

export async function startDaemonProcess(
	options: ConnectDaemonClientOptions
): Promise<void> {
	const runtimeFactoryModulePath =
		options.runtimeFactoryModulePath ?? resolveDefaultRuntimeFactoryModulePath();
	const startCommand = createDaemonStartCommand(options);
	options.logLine?.(
		`Starting Mission daemon (${startCommand.launchMode}) with ${startCommand.command} ${startCommand.args.join(' ')}`
	);

	const child = spawn(startCommand.command, startCommand.args, {
		cwd: options.surfacePath,
		env: {
			...process.env,
			MISSION_SURFACE_PATH: options.surfacePath,
			MISSION_DAEMON_LAUNCH_MODE: startCommand.launchMode,
			...(runtimeFactoryModulePath
				? { MISSION_RUNTIME_FACTORY_MODULE: runtimeFactoryModulePath }
				: {})
		},
		stdio: 'ignore',
		detached: true,
		windowsHide: true,
		...(startCommand.shell ? { shell: startCommand.shell } : {})
	});
	child.unref();
}

function resolveDefaultRuntimeFactoryModulePath(): string | undefined {
	const currentFilePath = fileURLToPath(import.meta.url);
	const packageRoot = getDaemonPackageRoot();
	const workspaceRoot = path.dirname(path.dirname(packageRoot));
	const sourcePath = path.join(workspaceRoot, 'packages', 'adapters', 'src', 'index.ts');
	const buildPath = path.join(workspaceRoot, 'packages', 'adapters', 'build', 'index.js');

	if (currentFilePath.includes(`${path.sep}src${path.sep}`) && fs.existsSync(sourcePath)) {
		return sourcePath;
	}

	if (fs.existsSync(buildPath)) {
		return buildPath;
	}

	if (fs.existsSync(sourcePath)) {
		return sourcePath;
	}

	return undefined;
}

function createDaemonStartCommand(
	options: ConnectDaemonClientOptions
): DaemonStartCommand {
	const launchMode = resolveAvailableDaemonLaunchMode(options.preferredLaunchMode);
	const missiondCommand = resolveMissiondCommand();
	const socketArgs = options.socketPath ? ['--socket', options.socketPath] : [];
	return {
		command: missiondCommand,
		args: ['start', ...socketArgs],
		launchMode,
		...(process.platform === 'win32' ? { shell: true } : {})
	};
}

function resolveAvailableDaemonLaunchMode(
	preferredLaunchMode: DaemonLaunchMode = 'build'
): DaemonLaunchMode {
	const packageRoot = getDaemonPackageRoot();
	const sourceEntryPoint = path.join(packageRoot, 'src', 'daemon', 'main.ts');
	const buildEntryPoint = path.join(packageRoot, 'build', 'daemon', 'main.js');

	if (preferredLaunchMode === 'source' && fs.existsSync(sourceEntryPoint)) {
		return 'source';
	}

	if (fs.existsSync(buildEntryPoint)) {
		return 'build';
	}

	if (fs.existsSync(sourceEntryPoint)) {
		return 'source';
	}

	throw new Error('Mission daemon entrypoint is missing. Build the core package first.');
}

function getDaemonPackageRoot(): string {
	const currentFilePath = fileURLToPath(import.meta.url);
	const currentDirectory = path.dirname(currentFilePath);
	const baseDirectory = path.basename(currentDirectory);
	const parentDirectory = path.dirname(currentDirectory);
	const parentBaseDirectory = path.basename(parentDirectory);

	if (
		(baseDirectory === 'client' || baseDirectory === 'daemon') &&
		(parentBaseDirectory === 'src' || parentBaseDirectory === 'build')
	) {
		return path.dirname(parentDirectory);
	}

	return baseDirectory === 'src' || baseDirectory === 'build'
		? path.dirname(currentDirectory)
		: currentDirectory;
}

function resolveMissiondCommand(): string {
	const configuredCommand = process.env['MISSION_DAEMON_COMMAND']?.trim();
	if (configuredCommand) {
		return configuredCommand;
	}

	return process.platform === 'win32' ? 'missiond.cmd' : 'missiond';
}

async function ensureCompatibleDaemon(client: DaemonClient): Promise<void> {
	const ping = await client.request<Ping>('ping');
	if (ping.protocolVersion !== PROTOCOL_VERSION) {
		throw new IncompatibleDaemonError(ping.pid, ping.protocolVersion);
	}
}

async function stopIncompatibleDaemon(
	error: unknown,
	options: ConnectDaemonClientOptions
): Promise<void> {
	if (!(error instanceof IncompatibleDaemonError) || error.pid === undefined) {
		return;
	}

	options.logLine?.(
		`Stopping incompatible Mission daemon pid=${String(error.pid)} protocol=${String(error.protocolVersion ?? 'unknown')}.`
	);

	try {
		process.kill(error.pid, 'SIGTERM');
	} catch (signalError) {
		const code = (signalError as NodeJS.ErrnoException).code;
		if (code !== 'ESRCH') {
			throw signalError;
		}
	}

	await waitForDaemonShutdown(options);
}

async function waitForDaemonShutdown(options: ConnectDaemonClientOptions): Promise<void> {
	const socketPath = resolveDaemonSocketPath(options.socketPath);
	const timeoutAt = Date.now() + 5000;
	while (Date.now() < timeoutAt) {
		if (!(await canConnectToSocket(socketPath))) {
			return;
		}
		await delay(100);
	}

	throw new Error(`Mission daemon on '${socketPath}' did not stop in time.`);
}

async function canConnectToSocket(socketPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const socket = net.createConnection(socketPath);
		const finalize = (connected: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(connected);
		};

		socket.once('connect', () => {
			finalize(true);
		});
		socket.once('error', () => {
			finalize(false);
		});
	});
}
