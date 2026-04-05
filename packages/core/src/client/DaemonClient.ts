import * as net from 'node:net';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
} from '../daemon/MissionAgentRuntime.js';
import type {
	Message,
	Method,
	Notification,
	Request
} from '../daemon/protocol.js';
import {
	readDaemonManifest,
	resolveDaemonSocketPath
} from '../daemon/daemonPaths.js';

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

export class DaemonClient implements MissionAgentDisposable {
	private socket: net.Socket | undefined;
	private buffer = '';
	private nextRequestId = 0;
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly eventEmitter = new MissionAgentEventEmitter<Notification>();
	private surfacePath = '';

	public readonly onDidEvent = this.eventEmitter.event;

	public async connect(options: { surfacePath: string; socketPath?: string }): Promise<this> {
		this.surfacePath = options.surfacePath;
		if (this.socket && !this.socket.destroyed) {
			return this;
		}

		const socketPath = options.socketPath?.trim() || (await this.resolveSocketPath());
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(socketPath);
			socket.setEncoding('utf8');
			socket.once('connect', () => {
				this.socket = socket;
				this.attachSocket(socket);
				resolve();
			});
			socket.once('error', (error) => {
				reject(error);
			});
		});

		return this;
	}

	public async request<TResult>(
		method: Method,
		params?: unknown
	): Promise<TResult> {
		if (!this.socket || this.socket.destroyed) {
			throw new Error('Daemon client is not connected.');
		}

		const id = `request-${String(++this.nextRequestId)}`;
		const includeSurfacePath = shouldIncludeSurfacePath(method, params);
		const request: Request = {
			type: 'request',
			id,
			method,
			...(includeSurfacePath ? { surfacePath: this.surfacePath } : {}),
			...(params === undefined ? {} : { params })
		};

		const response = await new Promise<unknown>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			this.socket?.write(`${JSON.stringify(request)}\n`);
		});

		return response as TResult;
	}

	public dispose(): void {
		this.rejectPendingRequests(new Error('Daemon client was disposed.'));
		this.socket?.destroy();
		this.socket = undefined;
		this.eventEmitter.dispose();
	}

	private attachSocket(socket: net.Socket): void {
		socket.on('data', (chunk: string) => {
			this.buffer += chunk;
			while (true) {
				const newlineIndex = this.buffer.indexOf('\n');
				if (newlineIndex < 0) {
					break;
				}

				const line = this.buffer.slice(0, newlineIndex).trim();
				this.buffer = this.buffer.slice(newlineIndex + 1);
				if (!line) {
					continue;
				}

				this.handleLine(line);
			}
		});

		socket.once('error', (error) => {
			this.rejectPendingRequests(error instanceof Error ? error : new Error(String(error)));
		});
		socket.once('close', () => {
			this.rejectPendingRequests(new Error('Mission daemon connection closed.'));
		});
	}

	private handleLine(line: string): void {
		const message = JSON.parse(line) as Message;
		if (message.type === 'event') {
			this.eventEmitter.fire(message.event);
			return;
		}

		if (message.type !== 'response') {
			return;
		}

		const pendingRequest = this.pendingRequests.get(message.id);
		if (!pendingRequest) {
			return;
		}

		this.pendingRequests.delete(message.id);
		if (message.ok) {
			pendingRequest.resolve(message.result);
			return;
		}

		pendingRequest.reject(new Error(message.error.message));
	}

	private rejectPendingRequests(error: Error): void {
		for (const pendingRequest of this.pendingRequests.values()) {
			pendingRequest.reject(error);
		}
		this.pendingRequests.clear();
	}

	private async resolveSocketPath(): Promise<string> {
		const manifest = await readDaemonManifest();
		return manifest?.endpoint.path ?? resolveDaemonSocketPath();
	}
}

function shouldIncludeSurfacePath(method: Method, params: unknown): boolean {
	if (
		method === 'control.status'
		|| method === 'control.settings.update'
		|| method === 'control.mission.bootstrap'
		|| method === 'control.mission.start'
		|| method === 'control.issues.list'
	) {
		return true;
	}

	if (method !== 'command.execute') {
		return false;
	}

	if (!params || typeof params !== 'object' || !('selector' in params)) {
		return true;
	}

	const selector = (params as { selector?: { missionId?: string } }).selector;
	return !selector?.missionId;
}