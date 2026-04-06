import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
	DaemonClient,
	PROTOCOL_VERSION,
	resolveDaemonSocketPath,
	type Ping
} from '@flying-pillow/mission-core';

type MissionDaemonLaunchMode = 'build' | 'source';

type ConnectMissionDaemonOptions = {
	surfacePath: string;
	startupTimeoutMs?: number;
	logLine?: (line: string) => void;
	runtimeFactoryModulePath?: string;
	launchMode?: MissionDaemonLaunchMode;
	command?: string;
	socketPath?: string;
};

type DaemonStartCommand = {
	command: string;
	args: string[];
	launchMode: MissionDaemonLaunchMode;
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

export async function connectMissionDaemon(
	options: ConnectMissionDaemonOptions
): Promise<DaemonClient> {
	const runtimeFactoryModulePath =
		options.runtimeFactoryModulePath ?? resolveDefaultRuntimeFactoryModulePath();

	try {
		return await connectCompatibleDaemon(options.surfacePath, options.socketPath);
	} catch (error) {
		await stopIncompatibleDaemon(error, options);
	}

	await startMissionDaemon(options, runtimeFactoryModulePath);

	const timeoutAt = Date.now() + (options.startupTimeoutMs ?? 15_000);
	let lastError: Error | undefined;
	while (Date.now() < timeoutAt) {
		try {
			return await connectCompatibleDaemon(options.surfacePath, options.socketPath);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
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

export function resolveMissionDaemonLaunchMode(
	moduleUrl: string | URL
): MissionDaemonLaunchMode {
	const modulePath = fileURLToPath(moduleUrl);
	return modulePath.includes(`${path.sep}src${path.sep}`) ? 'source' : 'build';
}

async function connectCompatibleDaemon(
	surfacePath: string,
	socketPath?: string
): Promise<DaemonClient> {
	const client = new DaemonClient();
	try {
		await client.connect({
			surfacePath,
			...(socketPath ? { socketPath } : {})
		});
		const ping = await client.request<Ping>('ping');
		if (ping.protocolVersion !== PROTOCOL_VERSION) {
			throw new IncompatibleDaemonError(ping.pid, ping.protocolVersion);
		}
		return client;
	} catch (error) {
		client.dispose();
		throw error;
	}
}

async function startMissionDaemon(
	options: ConnectMissionDaemonOptions,
	runtimeFactoryModulePath?: string
): Promise<void> {
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

function createDaemonStartCommand(
	options: ConnectMissionDaemonOptions
): DaemonStartCommand {
	const launchMode = options.launchMode ?? resolveMissionDaemonLaunchMode(import.meta.url);
	const daemonCommand = options.command?.trim() || process.env['MISSION_DAEMON_COMMAND']?.trim();
	const socketArgs = options.socketPath ? ['--socket', options.socketPath] : [];
	return {
		command: daemonCommand || (process.platform === 'win32' ? 'missiond.cmd' : 'missiond'),
		args: ['start', ...socketArgs],
		launchMode,
		...(process.platform === 'win32' ? { shell: true } : {})
	};
}

function resolveDefaultRuntimeFactoryModulePath(): string | undefined {
	const currentFilePath = fileURLToPath(import.meta.url);
	const packageRoot = path.resolve(path.dirname(currentFilePath), '..');
	const workspaceRoot = path.resolve(packageRoot, '..', '..');
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

async function stopIncompatibleDaemon(
	error: unknown,
	options: ConnectMissionDaemonOptions
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

	await waitForDaemonShutdown(options.socketPath);
}

async function waitForDaemonShutdown(socketPath?: string): Promise<void> {
	const resolvedSocketPath = resolveDaemonSocketPath(socketPath);
	const timeoutAt = Date.now() + 5_000;
	while (Date.now() < timeoutAt) {
		if (!(await canConnectToSocket(resolvedSocketPath))) {
			return;
		}
		await delay(100);
	}

	throw new Error(`Mission daemon on '${resolvedSocketPath}' did not stop in time.`);
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