import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../client/DaemonClient.js';
import { PROTOCOL_VERSION, type Ping } from '../daemon/protocol/transport.js';
import {
	type DaemonRuntimeMode,
	resolveDefaultRuntimeFactoryModulePath,
	startMissionDaemonProcess,
	stopMissionDaemonProcess
} from '../daemon/runtime/DaemonProcessControl.js';

export type ConnectAirportDaemonOptions = {
	surfacePath: string;
	startupTimeoutMs?: number;
	handshakeTimeoutMs?: number;
	runtimeMode?: DaemonRuntimeMode;
	runtimeFactoryModulePath?: string;
	logLine?: (line: string) => void;
	allowStart?: boolean;
	authToken?: string;
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

export function resolveAirportDaemonRuntimeMode(moduleUrl: string | URL): DaemonRuntimeMode {
	const environmentRuntimeMode = readConfiguredRuntimeMode();
	if (environmentRuntimeMode) {
		return environmentRuntimeMode;
	}

	const modulePath = fileURLToPath(moduleUrl);
	return modulePath.includes(`${path.sep}src${path.sep}`) ? 'source' : 'build';
}

export async function connectAirportDaemon(
	options: ConnectAirportDaemonOptions
): Promise<DaemonClient> {
	const runtimeMode = options.runtimeMode ?? resolveAirportDaemonRuntimeMode(import.meta.url);
	const handshakeTimeoutMs = Math.min(options.handshakeTimeoutMs ?? 3_000, options.startupTimeoutMs ?? 15_000);
	const runtimeFactoryModulePath =
		options.runtimeFactoryModulePath ?? resolveDefaultRuntimeFactoryModulePath(runtimeMode);
	const allowStart = options.allowStart !== false;

	try {
		return await connectCompatibleDaemon(options.surfacePath, options.authToken, handshakeTimeoutMs);
	} catch (error) {
		if (!allowStart) {
			throw error;
		}
		await restartIncompatibleDaemon(error, options.logLine);
	}

	await startMissionDaemonProcess({
		surfacePath: options.surfacePath,
		runtimeMode,
		...(runtimeFactoryModulePath ? { runtimeFactoryModulePath } : {})
	});

	const timeoutAt = Date.now() + (options.startupTimeoutMs ?? 15_000);
	let lastError: Error | undefined;
	while (Date.now() < timeoutAt) {
		try {
			return await connectCompatibleDaemon(options.surfacePath, options.authToken, handshakeTimeoutMs);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await restartIncompatibleDaemon(error, options.logLine);
			await delay(150);
		}
	}

	throw new Error(
		lastError
			? `Mission daemon did not become ready: ${lastError.message}`
			: 'Mission daemon did not become ready.'
	);
}

async function connectCompatibleDaemon(
	surfacePath: string,
	authToken?: string,
	handshakeTimeoutMs = 3_000
): Promise<DaemonClient> {
	const client = new DaemonClient();
	try {
		client.setAuthToken(authToken);
		await client.connect({ surfacePath, timeoutMs: handshakeTimeoutMs });
		const ping = await client.request<Ping>('ping', undefined, { timeoutMs: handshakeTimeoutMs });
		if (ping.protocolVersion !== PROTOCOL_VERSION) {
			throw new IncompatibleDaemonError(ping.pid, ping.protocolVersion);
		}
		return client;
	} catch (error) {
		client.dispose();
		throw error;
	}
}

async function restartIncompatibleDaemon(
	error: unknown,
	logLine?: (line: string) => void
): Promise<void> {
	if (!(error instanceof IncompatibleDaemonError)) {
		return;
	}

	logLine?.(
		`Stopping incompatible Mission daemon pid=${String(error.pid ?? 'unknown')} protocol=${String(error.protocolVersion ?? 'unknown')}.`
	);
	await stopMissionDaemonProcess();
}

function readConfiguredRuntimeMode(): DaemonRuntimeMode | undefined {
	const runtimeMode = process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim();
	return runtimeMode === 'source' || runtimeMode === 'build' ? runtimeMode : undefined;
}