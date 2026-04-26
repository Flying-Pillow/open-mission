import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import {
	getDaemonManifestPath,
	getDaemonRuntimePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';
import {
	PROTOCOL_VERSION,
	type Manifest,
	type Ping,
	type Request,
	type Response
} from './protocol/contracts.js';
import {
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from './entityRemote.js';

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const socketPath = resolveDaemonSocketPath(readSocketOverride(argv));
	const manifestPath = getDaemonManifestPath();
	const startedAt = new Date().toISOString();
	const sockets = new Set<net.Socket>();
	let shuttingDown = false;

	await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
	if (!isNamedPipePath(socketPath)) {
		await fs.rm(socketPath, { force: true }).catch(() => undefined);
	}

	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding('utf8');
		let buffer = '';

		socket.on('data', (chunk: string) => {
			buffer += chunk;
			while (true) {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex < 0) {
					break;
				}

				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) {
					continue;
				}

				void handleRequestLine(socket, line, startedAt);
			}
		});

		socket.once('close', () => {
			sockets.delete(socket);
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, () => {
			server.off('error', reject);
			resolve();
		});
	});

	const manifest: Manifest = {
		pid: process.pid,
		startedAt,
		protocolVersion: PROTOCOL_VERSION,
		endpoint: {
			transport: 'ipc',
			path: socketPath,
		},
	};
	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

	const shutdown = async (): Promise<void> => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		for (const socket of sockets) {
			socket.destroy();
		}
		await new Promise<void>((resolve) => {
			if (!server.listening) {
				resolve();
				return;
			}
			server.close(() => resolve());
		});
	};

	const handleTerminationSignal = () => {
		void shutdown();
	};
	process.once('SIGINT', handleTerminationSignal);
	process.once('SIGTERM', handleTerminationSignal);

	try {
		await new Promise<void>((resolve, reject) => {
			server.once('close', () => resolve());
			server.once('error', reject);
		});
	} finally {
		process.off('SIGINT', handleTerminationSignal);
		process.off('SIGTERM', handleTerminationSignal);
		await fs.rm(manifestPath, { force: true }).catch(() => undefined);
		if (!isNamedPipePath(socketPath)) {
			await fs.rm(socketPath, { force: true }).catch(() => undefined);
		}
	}
}

async function handleRequestLine(socket: net.Socket, line: string, startedAt: string): Promise<void> {
	let request: Request;
	try {
		request = JSON.parse(line) as Request;
	} catch {
		return;
	}

	if (request.type !== 'request') {
		return;
	}

	const response = await createResponse(request, startedAt);
	if (!socket.destroyed) {
		socket.write(`${JSON.stringify(response)}\n`);
	}
}

async function createResponse(request: Request, startedAt: string): Promise<Response> {
	try {
		switch (request.method) {
			case 'ping': {
				const result: Ping = {
					ok: true,
					pid: process.pid,
					startedAt,
					protocolVersion: PROTOCOL_VERSION,
				};
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result,
				};
			}
			case 'system.status': {
				const { readSystemStatus } = await import('../system/SystemStatus.js');
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result: readSystemStatus({
						cwd: resolveSurfacePath(request.surfacePath),
						...(request.authToken?.trim() ? { authToken: request.authToken.trim() } : {}),
					}),
				};
			}
			case 'entity.query': {
				const { entityQueryInvocationSchema } = await import('../airport/entityRemote.js');
				const authToken = request.authToken?.trim();
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result: await executeEntityQueryInDaemon(
						entityQueryInvocationSchema.parse(request.params),
						{
							surfacePath: resolveSurfacePath(request.surfacePath),
							...(authToken ? { authToken } : {})
						}
					)
				};
			}
			case 'entity.command': {
				const {
					entityCommandInvocationSchema,
					entityFormInvocationSchema
				} = await import('../airport/entityRemote.js');
				const commandInvocation = entityCommandInvocationSchema.safeParse(request.params);
				const authToken = request.authToken?.trim();
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result: await executeEntityCommandInDaemon(
						commandInvocation.success
							? commandInvocation.data
							: entityFormInvocationSchema.parse(request.params),
						{
							surfacePath: resolveSurfacePath(request.surfacePath),
							...(authToken ? { authToken } : {})
						}
					)
				};
			}
			default:
				return {
					type: 'response',
					id: request.id,
					ok: false,
					error: {
						code: 'NOT_IMPLEMENTED',
						message: `Mission daemon method '${request.method}' is not implemented in the minimal source daemon.`,
					},
				};
		}
	} catch (error) {
		return {
			type: 'response',
			id: request.id,
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

function readSocketOverride(argv: string[]): string | undefined {
	const socketFlagIndex = argv.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? argv[socketFlagIndex + 1] : undefined;
	return socketPath?.trim() || undefined;
}

function resolveSurfacePath(surfacePath: string | undefined): string {
	return surfacePath?.trim() || process.env['MISSION_SURFACE_PATH']?.trim() || process.cwd();
}