import { DaemonClient } from './DaemonClient.js';
import { PROTOCOL_VERSION, type Ping } from '../protocol/contracts.js';

export type ConnectDaemonOptions = {
	surfacePath: string;
	handshakeTimeoutMs?: number;
	authToken?: string;
};

class IncompatibleDaemonError extends Error {
	public constructor(
		public readonly pid: number | undefined,
		public readonly protocolVersion: number | undefined
	) {
		super(
			`Open Mission daemon protocol ${String(protocolVersion ?? 'unknown')} is incompatible with client protocol ${String(PROTOCOL_VERSION)}.`
		);
		this.name = 'IncompatibleDaemonError';
	}
}

export async function connectDaemon(
	options: ConnectDaemonOptions
): Promise<DaemonClient> {
	const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 3_000;
	const client = new DaemonClient();
	try {
		client.setAuthToken(options.authToken);
		await client.connect({ surfacePath: options.surfacePath, timeoutMs: handshakeTimeoutMs });
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