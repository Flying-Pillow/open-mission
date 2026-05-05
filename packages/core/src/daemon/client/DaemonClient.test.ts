import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getDaemonRuntimePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from '../daemonPaths.js';
import { DaemonClient } from './DaemonClient.js';

describe('DaemonClient', () => {
	it('emits disconnect when a live daemon socket closes', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-'));
		const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-runtime-'));
		const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
		process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
		const socketPath = resolveDaemonSocketPath();
		const sockets = new Set<net.Socket>();
		const server = net.createServer((socket) => {
			sockets.add(socket);
			socket.once('close', () => {
				sockets.delete(socket);
			});
		});

		try {
			if (!isNamedPipePath(socketPath)) {
				await fs.mkdir(path.dirname(socketPath), { recursive: true });
			}

			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(socketPath, () => {
					server.off('error', reject);
					resolve();
				});
			});

			const client = new DaemonClient();
			await client.connect({ surfacePath: workspaceRoot, timeoutMs: 250 });
			const disconnected = new Promise<Error>((resolve) => {
				client.onDidDisconnect(resolve);
			});
			for (const socket of sockets) {
				socket.destroy();
			}

			await expect(disconnected).resolves.toMatchObject({
				message: 'Mission daemon connection closed.'
			});
			client.dispose();
		} finally {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve, reject) => {
				if (!server.listening) {
					resolve();
					return;
				}
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			if (!isNamedPipePath(socketPath)) {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(
					() => undefined
				);
			}
			if (previousRuntimeDirectory === undefined) {
				delete process.env['XDG_RUNTIME_DIR'];
			} else {
				process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
			}
			await fs.rm(runtimeRoot, { recursive: true, force: true });
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('connects through the deterministic socket path when the manifest is missing', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-'));
		const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-runtime-'));
		const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
		process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
		const socketPath = resolveDaemonSocketPath();
		const server = net.createServer();

		try {
			if (!isNamedPipePath(socketPath)) {
				await fs.mkdir(path.dirname(socketPath), { recursive: true });
			}

			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(socketPath, () => {
					server.off('error', reject);
					resolve();
				});
			});

			const client = new DaemonClient();
			await expect(client.connect({ surfacePath: workspaceRoot })).resolves.toBe(client);
			client.dispose();
		} finally {
			await new Promise<void>((resolve, reject) => {
				if (!server.listening) {
					resolve();
					return;
				}
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			if (!isNamedPipePath(socketPath)) {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(
					() => undefined
				);
			}
			if (previousRuntimeDirectory === undefined) {
				delete process.env['XDG_RUNTIME_DIR'];
			} else {
				process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
			}
			await fs.rm(runtimeRoot, { recursive: true, force: true });
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('times out requests when the daemon accepts a socket but never replies', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-'));
		const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-runtime-'));
		const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
		process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
		const socketPath = resolveDaemonSocketPath();
		const sockets = new Set<net.Socket>();
		const server = net.createServer((socket) => {
			sockets.add(socket);
			socket.setEncoding('utf8');
			socket.once('close', () => {
				sockets.delete(socket);
			});
		});

		try {
			if (!isNamedPipePath(socketPath)) {
				await fs.mkdir(path.dirname(socketPath), { recursive: true });
			}

			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(socketPath, () => {
					server.off('error', reject);
					resolve();
				});
			});

			const client = new DaemonClient();
			await client.connect({ surfacePath: workspaceRoot, timeoutMs: 250 });
			await expect(client.request('ping', undefined, { timeoutMs: 50 })).rejects.toThrow(
				"Mission daemon request 'ping' timed out after 50ms."
			);
			client.dispose();
		} finally {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve, reject) => {
				if (!server.listening) {
					resolve();
					return;
				}
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			if (!isNamedPipePath(socketPath)) {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(
					() => undefined
				);
			}
			if (previousRuntimeDirectory === undefined) {
				delete process.env['XDG_RUNTIME_DIR'];
			} else {
				process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
			}
			await fs.rm(runtimeRoot, { recursive: true, force: true });
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});