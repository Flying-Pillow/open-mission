import * as net from 'node:net';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
	} from '../daemon/events.js';
import type {
	Message,
	Method,
	Notification,
	Response,
	Request
} from '../daemon/contracts.js';
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
		const includeSurfacePath = shouldIncludeSurfacePath(method);
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

		pendingRequest.reject(createDaemonClientError(message));
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

function createDaemonClientError(message: Extract<Response, { type: 'response'; ok: false }>): Error {
	const error = new Error(message.error.message) as Error & {
		code?: string;
		validationErrors?: unknown;
	};
	if (message.error.code) {
		error.code = message.error.code;
	}
	if (message.error.validationErrors) {
		error.validationErrors = message.error.validationErrors;
	}
	return error;
}

function shouldIncludeSurfacePath(method: Method): boolean {
	if (
		method === 'airport.status'
		|| method === 'airport.client.connect'
		|| method === 'airport.client.observe'
		|| method === 'airport.pane.bind'
		|| method === 'control.status'
		|| method === 'control.settings.update'
		|| method === 'control.document.read'
		|| method === 'control.document.write'
		|| method === 'control.action.list'
		|| method === 'control.action.describe'
		|| method === 'control.action.execute'
		|| method === 'control.workflow.settings.get'
		|| method === 'control.workflow.settings.initialize'
		|| method === 'control.workflow.settings.update'
		|| method === 'control.repositories.list'
		|| method === 'control.repositories.add'
		|| method === 'mission.from-brief'
		|| method === 'mission.from-issue'
	) {
		return true;
	}

	return false;
}