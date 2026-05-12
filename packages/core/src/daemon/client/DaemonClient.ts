import * as net from 'node:net';
import {
	AgentRuntimeEventEmitter,
	type AgentRuntimeDisposable
} from '../runtime/agent/events.js';
import type { EntityEventEnvelopeType } from '../../entities/Entity/EntitySchema.js';
import { METHOD_METADATA } from '../protocol/contracts.js';
import type {
	Message,
	Method,
	Response,
	Request
} from '../protocol/contracts.js';
import {
	readDaemonManifest,
	resolveDaemonSocketPath
} from '../daemonPaths.js';

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

export class DaemonClient implements AgentRuntimeDisposable {
	private socket: net.Socket | undefined;
	private socketPath: string | undefined;
	private buffer = '';
	private nextRequestId = 0;
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly eventEmitter = new AgentRuntimeEventEmitter<EntityEventEnvelopeType>();
	private readonly disconnectEmitter = new AgentRuntimeEventEmitter<Error>();
	private surfacePath = '';
	private authToken = '';

	public readonly onDidEvent = this.eventEmitter.event;
	public readonly onDidDisconnect = this.disconnectEmitter.event;

	public setAuthToken(authToken: string | undefined): void {
		this.authToken = authToken?.trim() ?? '';
	}

	public async connect(options: { surfacePath: string; socketPath?: string; timeoutMs?: number }): Promise<this> {
		this.surfacePath = options.surfacePath;
		if (this.socket && !this.socket.destroyed) {
			return this;
		}

		const socketPath = options.socketPath?.trim() || this.socketPath || (await this.resolveSocketPath());
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(socketPath);
			const timeoutMs = options.timeoutMs;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			let settled = false;

			const cleanup = () => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
					timeoutHandle = undefined;
				}
				socket.off('connect', onConnect);
				socket.off('error', onError);
			};

			const fail = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				socket.destroy();
				reject(error);
			};

			const onConnect = () => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				this.socket = socket;
				this.socketPath = socketPath;
				this.buffer = '';
				this.attachSocket(socket);
				resolve();
			};

			const onError = (error: Error) => {
				fail(error);
			};

			socket.setEncoding('utf8');
			socket.once('connect', onConnect);
			socket.once('error', onError);
			if (timeoutMs && timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					fail(new Error(`Mission daemon connection timed out after ${String(timeoutMs)}ms.`));
				}, timeoutMs);
			}
		});

		return this;
	}

	public async request<TResult>(
		method: Method,
		params?: unknown,
		options: { authToken?: string; timeoutMs?: number } = {}
	): Promise<TResult> {
		if (!this.socket || this.socket.destroyed) {
			if (!this.surfacePath) {
				throw new Error('Daemon client is not connected.');
			}
			await this.connect({
				surfacePath: this.surfacePath,
				...(this.socketPath ? { socketPath: this.socketPath } : {})
			});
			if (!this.socket || this.socket.destroyed) {
				throw new Error('Daemon client is not connected.');
			}
		}

		const id = `request-${String(++this.nextRequestId)}`;
		const includeSurfacePath = METHOD_METADATA[method].includeSurfacePath;
		const resolvedAuthToken = options.authToken?.trim() ?? this.authToken;
		const request: Request = {
			type: 'request',
			id,
			method,
			...(includeSurfacePath ? { surfacePath: this.surfacePath } : {}),
			...(resolvedAuthToken ? { authToken: resolvedAuthToken } : {}),
			...(params === undefined ? {} : { params })
		};

		const response = await new Promise<unknown>((resolve, reject) => {
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const finish = <T>(callback: (value: T) => void, value: T) => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
					timeoutHandle = undefined;
				}
				callback(value);
			};

			this.pendingRequests.set(id, {
				resolve: (value) => {
					finish(resolve, value);
				},
				reject: (error) => {
					finish(reject, error);
				}
			});
			if (options.timeoutMs && options.timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					this.pendingRequests.delete(id);
					reject(new Error(`Mission daemon request '${method}' timed out after ${String(options.timeoutMs)}ms.`));
				}, options.timeoutMs);
			}
			this.socket?.write(`${JSON.stringify(request)}\n`);
		});

		return response as TResult;
	}

	public dispose(): void {
		this.rejectPendingRequests(new Error('Daemon client was disposed.'));
		this.socket?.destroy();
		this.socket = undefined;
		this.eventEmitter.dispose();
		this.disconnectEmitter.dispose();
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
			if (this.socket === socket) {
				this.socket = undefined;
				this.disconnectEmitter.fire(error instanceof Error ? error : new Error(String(error)));
			}
			this.buffer = '';
			this.rejectPendingRequests(error instanceof Error ? error : new Error(String(error)));
		});
		socket.once('close', () => {
			if (this.socket === socket) {
				this.socket = undefined;
				this.disconnectEmitter.fire(new Error('Mission daemon connection closed.'));
			}
			this.buffer = '';
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