import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Socket } from 'node:net';
import {
	PROTOCOL_VERSION,
	type ErrorResponse,
	type EventMessage,
	type Manifest,
	type Message,
	type Notification,
	type Ping,
	type Request,
	type Response
} from './protocol.js';
import {
	getDaemonManifestPath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';
import type { MissionAgentRuntime } from './MissionAgentRuntime.js';
import { WorkspaceManager } from './WorkspaceManager.js';

export type DaemonOptions = {
	logLine?: (line: string) => void;
	socketPath?: string;
	runtimes?: MissionAgentRuntime[];
};

export class Daemon {
	private readonly server = net.createServer();
	private readonly clients = new Set<Socket>();
	private readonly runtimes = new Map<string, MissionAgentRuntime>();
	private readonly workspaceManager: WorkspaceManager;
	private readonly shutdownPromise: Promise<void>;
	private readonly socketPath: string;
	private readonly logLine: ((line: string) => void) | undefined;
	private resolveShutdown!: () => void;
	private manifest?: Manifest;
	private closed = false;

	public constructor(options: DaemonOptions = {}) {
		this.socketPath = resolveDaemonSocketPath(options.socketPath);
		this.logLine = options.logLine;
		for (const runtime of options.runtimes ?? []) {
			this.runtimes.set(runtime.id, runtime);
		}
		this.workspaceManager = new WorkspaceManager(this.runtimes, (event) => this.broadcastEvent(event));
		this.shutdownPromise = new Promise<void>((resolve) => {
			this.resolveShutdown = resolve;
		});
		this.server.on('connection', (socket) => {
			this.handleConnection(socket);
		});
	}

	public getManifest(): Manifest | undefined {
		return this.manifest ? structuredClone(this.manifest) : undefined;
	}

	public async listen(): Promise<Manifest> {
		await this.prepareSocketPath();
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				this.server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				this.server.off('error', onError);
				resolve();
			};

			this.server.once('error', onError);
			this.server.once('listening', onListening);
			this.server.listen(this.socketPath);
		});

		this.manifest = {
			pid: process.pid,
			startedAt: new Date().toISOString(),
			protocolVersion: PROTOCOL_VERSION,
			endpoint: {
				transport: 'ipc',
				path: this.socketPath
			}
		};
		await this.writeManifest();
		this.logLine?.(`[Daemon] Listening on ${this.socketPath} (pid ${String(process.pid)})`);
		return structuredClone(this.manifest);
	}

	public waitUntilClosed(): Promise<void> {
		return this.shutdownPromise;
	}

	public async close(): Promise<void> {
		if (this.closed) {
			await this.shutdownPromise;
			return;
		}

		this.closed = true;
		this.logLine?.('[Daemon] Closing server.');
		for (const client of this.clients) {
			client.end();
			client.destroy();
		}
		this.clients.clear();

		await new Promise<void>((resolve, reject) => {
			if (!this.server.listening) {
				this.resolveShutdown();
				resolve();
				return;
			}

			this.server.close((error) => {
				this.resolveShutdown();
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	private handleConnection(socket: Socket): void {
		this.clients.add(socket);
		this.logLine?.(`[Daemon] Client connected (${String(this.clients.size)} total).`);
		socket.setEncoding('utf8');
		let buffer = '';

		socket.on('data', (chunk: string) => {
			buffer += chunk;
			while (true) {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex < 0) break;

				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) void this.handleLine(socket, line);
			}
		});

		socket.on('close', () => {
			this.clients.delete(socket);
			this.logLine?.(`[Daemon] Client disconnected (${String(this.clients.size)} remaining).`);
		});
		socket.on('error', (error) => {
			this.clients.delete(socket);
			this.logLine?.(`[Daemon] Client socket error: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	private async handleLine(socket: Socket, line: string): Promise<void> {
		try {
			const message = JSON.parse(line) as Message;
			if (message.type !== 'request') return;

			this.logLine?.(
				`[Daemon] Incoming ${message.method} request (${message.id})${message.surfacePath ? ` surface=${message.surfacePath}` : ''}`
			);
			const response = await this.handleRequest(message);
			if (this.clients.has(socket)) {
				socket.write(JSON.stringify(response) + '\n');
			}
		} catch (error) {
			this.logLine?.(`[Daemon] Failed to handle message: ${error}`);
		}
	}

	private async handleRequest(request: Request): Promise<Response> {
		try {
			const result = await this.executeMethod(request);
			return { type: 'response', id: request.id, ok: true, result };
		} catch (error) {
			return this.toErrorResponse(request.id, error);
		}
	}

	private async executeMethod(request: Request): Promise<any> {
		if (request.method === 'ping') {
			const pingResult: Ping = {
				ok: true,
				pid: process.pid,
				startedAt: this.manifest?.startedAt ?? new Date().toISOString(),
				protocolVersion: PROTOCOL_VERSION
			};
			return pingResult;
		}

		return this.workspaceManager.executeMethod(request);
	}

	private broadcastEvent(event: Notification): void {
		this.logLine?.(
			`[Daemon] Broadcasting ${event.type}${'missionId' in event ? ` mission=${event.missionId}` : ''}`
		);
		const message: EventMessage = { type: 'event', event };
		const wire = JSON.stringify(message) + '\n';
		for (const client of this.clients) {
			client.write(wire, (error) => {
				if (error) {
					this.clients.delete(client);
					client.destroy();
				}
			});
		}
	}

	private async writeManifest(): Promise<void> {
		const manifestPath = getDaemonManifestPath();
		await fs.mkdir(path.dirname(manifestPath), { recursive: true });
		await fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, '	') + '\n');
	}

	private async prepareSocketPath(): Promise<void> {
		if (isNamedPipePath(this.socketPath)) {
			return;
		}

		await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
		try {
			await fs.unlink(this.socketPath);
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	private toErrorResponse(id: string, error: unknown): ErrorResponse {
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
		return {
			type: 'response',
			id,
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
				...(code ? { code } : {})
			}
		};
	}
}

export async function startDaemon(options: DaemonOptions = {}): Promise<Daemon> {
	const server = new Daemon(options);
	await server.listen();
	return server;
}
