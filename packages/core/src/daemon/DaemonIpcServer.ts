import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import {
	getDaemonLockPath,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	isNamedPipePath,
	readDaemonManifest,
	resolveDaemonSocketPath
} from './daemonPaths.js';
import type { MissionRegistry } from './MissionRegistry.js';
import { MissionRegistry as MissionRegistryClass } from './MissionRegistry.js';
import { observeAgentSessionTerminalUpdates } from './AgentSessionTerminal.js';
import { observeMissionTerminalUpdates } from './MissionTerminal.js';
import { createAgentSessionTerminalEvent } from '../entities/AgentSession/AgentSessionContract.js';
import { createMissionTerminalEvent } from '../entities/Mission/MissionContract.js';
import { matchesEntityChannel } from '../entities/Entity/Entity.js';
import type { EntityEventEnvelopeType } from '../entities/Entity/EntitySchema.js';
import {
	entityCommandInvocationSchema,
	entityFormInvocationSchema,
	entityQueryInvocationSchema,
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from '../entities/Entity/EntityRemote.js';
import {
	PROTOCOL_VERSION,
	type EventSubscription,
	type Manifest,
	type Ping,
	type Request,
	type Response
} from './protocol/contracts.js';
import { DaemonLogger } from './runtime/DaemonLogger.js';
import type { MissionAgentDisposable } from './runtime/agent/events.js';
import { MissionMcpSignalServer } from './runtime/agent/mcp/MissionMcpSignalServer.js';
import { PolicyBoundAgentSessionSignalPort } from './runtime/agent/signals/AgentSessionSignalPort.js';

export type MissionDaemonHandle = {
	manifest: Manifest;
	socketPath: string;
	closed: Promise<void>;
	dispose: () => Promise<void>;
};

export type MissionDaemonStartOptions = {
	argv?: string[];
	socketPath?: string;
	surfacePath?: string;
	installSignalHandlers?: boolean;
};

type DaemonRuntimeLock = {
	lockPath: string;
	processId: number;
	createdAt: string;
	socketPath: string;
};

type DaemonRuntimeLockHandle = {
	release: () => Promise<void>;
};

const STALE_DAEMON_TERMINATION_TIMEOUT_MS = 2_000;

export type DaemonIpcServer = {
	server: net.Server;
	broadcastEvent: (event: EntityEventEnvelopeType) => void;
	destroyConnections: () => void;
};

export async function startMissionDaemon(options: MissionDaemonStartOptions = {}): Promise<MissionDaemonHandle> {
	const argv = options.argv ?? process.argv.slice(2);
	const socketPath = resolveDaemonSocketPath(options.socketPath ?? readSocketOverride(argv));
	const manifestPath = getDaemonManifestPath();
	const startedAt = new Date().toISOString();
	const logger = new DaemonLogger();
	await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
	await assertNoReachableDaemon(socketPath);
	const runtimeLock = await acquireDaemonRuntimeLock(socketPath);
	const missionRegistry = new MissionRegistryClass({ logger });
	const mcpSignalServer = new MissionMcpSignalServer({
		signalPort: new PolicyBoundAgentSessionSignalPort({
			sink: {
				getSnapshot: async (scope) => missionRegistry.getRuntimeSessionSnapshot(scope),
				commit: async (input) => missionRegistry.applyRuntimeSessionSignalDecision({
					scope: {
						missionId: input.snapshot.missionId,
						taskId: input.snapshot.taskId,
						agentSessionId: input.snapshot.sessionId
					},
					observation: input.observation,
					decision: input.decision
				})
			}
		})
	});
	missionRegistry.bindMcpSignalServer(mcpSignalServer);
	const ipcServer = createDaemonIpcServer({ startedAt, missionRegistry });
	const notificationSources = startEntityEventSources(ipcServer.broadcastEvent);
	let shuttingDown = false;
	let closeResolve: (() => void) | undefined;
	let closeReject: ((error: unknown) => void) | undefined;
	const closed = new Promise<void>((resolve, reject) => {
		closeResolve = resolve;
		closeReject = reject;
	});

	logger.info('Mission daemon starting.', { pid: process.pid, socketPath });
	let startupCompleted = false;

	try {
		await mcpSignalServer.start();
		await missionRegistry.hydrateDaemonMissions({ surfacePath: resolveSurfacePath(options.surfacePath) });
		logger.info('Mission daemon hydration completed.');
		if (!isNamedPipePath(socketPath)) {
			await fs.rm(socketPath, { force: true }).catch(() => undefined);
		}

		await new Promise<void>((resolve, reject) => {
			ipcServer.server.once('error', reject);
			ipcServer.server.listen(socketPath, () => {
				ipcServer.server.off('error', reject);
				resolve();
			});
		});
		startupCompleted = true;
	} finally {
		if (!startupCompleted) {
			missionRegistry.dispose();
			await mcpSignalServer.stop();
			notificationSources.dispose();
			await closeServer(ipcServer.server);
			await runtimeLock.release();
			await logger.flush();
		}
	}

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
	logger.info('Mission daemon started.', {
		pid: process.pid,
		protocolVersion: PROTOCOL_VERSION,
		socketPath
	});

	const shutdown = async (): Promise<void> => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		logger.info('Mission daemon shutting down.');
		missionRegistry.dispose();
		await mcpSignalServer.stop();
		notificationSources.dispose();
		ipcServer.destroyConnections();
		await closeServer(ipcServer.server);
		await fs.rm(manifestPath, { force: true }).catch(() => undefined);
		if (!isNamedPipePath(socketPath)) {
			await fs.rm(socketPath, { force: true }).catch(() => undefined);
		}
		await runtimeLock.release();
		await logger.flush();
	};

	const handleTerminationSignal = () => {
		void shutdown();
	};
	if (options.installSignalHandlers ?? false) {
		process.once('SIGINT', handleTerminationSignal);
		process.once('SIGTERM', handleTerminationSignal);
	}

	ipcServer.server.once('close', () => {
		if (options.installSignalHandlers ?? false) {
			process.off('SIGINT', handleTerminationSignal);
			process.off('SIGTERM', handleTerminationSignal);
		}
		closeResolve?.();
	});
	ipcServer.server.once('error', (error) => {
		closeReject?.(error);
	});

	return {
		manifest,
		socketPath,
		closed,
		dispose: shutdown
	};
}

export function createDaemonIpcServer(input: {
	startedAt: string;
	missionRegistry: MissionRegistry;
}): DaemonIpcServer {
	const sockets = new Set<net.Socket>();
	const subscriptionsBySocket = new Map<net.Socket, EventSubscription[]>();

	const broadcastEvent = (event: EntityEventEnvelopeType): void => {
		for (const socket of sockets) {
			if (socket.destroyed) {
				continue;
			}
			const subscriptions = subscriptionsBySocket.get(socket) ?? [];
			if (!subscriptions.some((subscription) => matchesSubscription(subscription, event))) {
				continue;
			}
			try {
				socket.write(`${JSON.stringify({ type: 'event', event })}\n`);
			} catch {
				socket.destroy();
			}
		}
	};

	const server = net.createServer((socket) => {
		sockets.add(socket);
		subscriptionsBySocket.set(socket, []);
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

				void handleRequestLine(socket, line, input.startedAt, subscriptionsBySocket, input.missionRegistry);
			}
		});

		socket.once('close', () => {
			sockets.delete(socket);
			subscriptionsBySocket.delete(socket);
		});

		socket.on('error', () => {
			sockets.delete(socket);
			subscriptionsBySocket.delete(socket);
		});
	});

	return {
		server,
		broadcastEvent,
		destroyConnections: () => {
			for (const socket of sockets) {
				socket.destroy();
			}
		}
	};
}

async function handleRequestLine(
	socket: net.Socket,
	line: string,
	startedAt: string,
	subscriptionsBySocket: Map<net.Socket, EventSubscription[]>,
	missionRegistry: MissionRegistry
): Promise<void> {
	let request: Request;
	try {
		request = JSON.parse(line) as Request;
	} catch {
		return;
	}

	if (request.type !== 'request') {
		return;
	}

	const response = await createDaemonResponse(request, startedAt, missionRegistry);
	if (!socket.destroyed) {
		try {
			socket.write(`${JSON.stringify(response)}\n`);
			registerSubscription(socket, request, subscriptionsBySocket);
		} catch {
			socket.destroy();
		}
	}
}

async function createDaemonResponse(request: Request, startedAt: string, missionRegistry: MissionRegistry): Promise<Response> {
	const requestStartedAt = performance.now();
	try {
		const response = await createDaemonResponseUnchecked(request, startedAt, missionRegistry);
		logSlowDaemonRequest(request, requestStartedAt);
		return response;
	} catch (error) {
		logSlowDaemonRequest(request, requestStartedAt);
		return createErrorResponse(request, error);
	}
}

async function createDaemonResponseUnchecked(request: Request, startedAt: string, missionRegistry: MissionRegistry): Promise<Response> {
	switch (request.method) {
		case 'ping': {
			const result: Ping = {
				ok: true,
				pid: process.pid,
				startedAt,
				protocolVersion: PROTOCOL_VERSION
			};
			return {
				type: 'response',
				id: request.id,
				ok: true,
				result
			};
		}
		case 'event.subscribe':
			return {
				type: 'response',
				id: request.id,
				ok: true,
				result: null
			};
		case 'system.status': {
			const { readSystemStatus } = await import('../system/SystemStatus.js');
			return {
				type: 'response',
				id: request.id,
				ok: true,
				result: readSystemStatus({
					cwd: resolveSurfacePath(request.surfacePath),
					...(request.authToken?.trim() ? { authToken: request.authToken.trim() } : {})
				})
			};
		}
		case 'entity.query':
			return {
				type: 'response',
				id: request.id,
				ok: true,
				result: await executeEntityQueryInDaemon(
					entityQueryInvocationSchema.parse(request.params),
					createEntityExecutionContext(request, missionRegistry)
				)
			};
		case 'entity.command': {
			const commandInvocation = entityCommandInvocationSchema.safeParse(request.params);
			const invocation = commandInvocation.success
				? commandInvocation.data
				: entityFormInvocationSchema.parse(request.params);
			return {
				type: 'response',
				id: request.id,
				ok: true,
				result: await executeEntityCommandInDaemon(
					invocation,
					createEntityExecutionContext(request, missionRegistry)
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
					message: `Mission daemon method '${request.method}' is not implemented in the daemon transport.`
				}
			};
	}
}

function createErrorResponse(request: Request, error: unknown): Response {
	return {
		type: 'response',
		id: request.id,
		ok: false,
		error: {
			message: error instanceof Error ? error.message : String(error)
		}
	};
}

function logSlowDaemonRequest(request: Request, startedAtMs: number): void {
	const durationMs = performance.now() - startedAtMs;
	if (process.env['MISSION_DAEMON_RUNTIME_MODE'] !== 'source' || durationMs < 1_000) {
		return;
	}

	const params = request.params && typeof request.params === 'object' ? request.params as {
		entity?: unknown;
		method?: unknown;
	} : undefined;
	process.stderr.write(`${JSON.stringify({
		source: 'mission-daemon',
		message: 'slow ipc request',
		method: request.method,
		entity: typeof params?.entity === 'string' ? params.entity : undefined,
		entityMethod: typeof params?.method === 'string' ? params.method : undefined,
		durationMs: Math.round(durationMs)
	})}\n`);
}

function registerSubscription(
	socket: net.Socket,
	request: Request,
	subscriptionsBySocket: Map<net.Socket, EventSubscription[]>
): void {
	if (request.method !== 'event.subscribe') {
		return;
	}
	const params = (request.params ?? {}) as EventSubscription;
	const subscriptions = subscriptionsBySocket.get(socket);
	if (!subscriptions) {
		return;
	}
	subscriptions.push({
		...(params.channels ? { channels: params.channels } : {})
	});
}

function matchesSubscription(subscription: EventSubscription, event: EntityEventEnvelopeType): boolean {
	return !subscription.channels?.length
		|| subscription.channels.some((channel) => matchesEntityChannel(event.channel, channel));
}

function createEntityExecutionContext(request: Request, missionRegistry: MissionRegistry) {
	return {
		surfacePath: resolveSurfacePath(request.surfacePath),
		missionRegistry,
		...(request.authToken?.trim() ? { authToken: request.authToken.trim() } : {})
	};
}

function startEntityEventSources(publish: (event: EntityEventEnvelopeType) => void): MissionAgentDisposable {
	const missionTerminalUpdates = observeMissionTerminalUpdates((event) => {
		publish(createMissionTerminalEvent(event));
	});
	const sessionTerminalUpdates = observeAgentSessionTerminalUpdates((event) => {
		publish(createAgentSessionTerminalEvent(event));
	});

	return {
		dispose: () => {
			missionTerminalUpdates.dispose();
			sessionTerminalUpdates.dispose();
		}
	};
}

async function acquireDaemonRuntimeLock(socketPath: string): Promise<DaemonRuntimeLockHandle> {
	const lockPath = getDaemonLockPath();
	const lock: DaemonRuntimeLock = {
		lockPath,
		processId: process.pid,
		createdAt: new Date().toISOString(),
		socketPath
	};

	for (let attempt = 0; attempt < 2; attempt += 1) {
		let fileHandle: fs.FileHandle | undefined;
		try {
			fileHandle = await fs.open(lockPath, 'wx');
			await fileHandle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
			return {
				release: () => releaseDaemonRuntimeLock(lockPath)
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}

			const existingLock = await readDaemonRuntimeLock(lockPath);
			if (existingLock && isProcessRunning(existingLock.processId)) {
				const existingSocketPath = existingLock.socketPath || socketPath;
				const reachableDaemon = await probeDaemonSocket(existingSocketPath);
				if (reachableDaemon) {
					throw new Error(
						`Mission daemon is already running with pid ${String(reachableDaemon.pid)} at '${existingSocketPath}'. Stop it before starting another daemon.`
					);
				}

				await terminateStaleDaemonProcess(existingLock.processId);
			}

			await fs.rm(lockPath, { force: true }).catch(() => undefined);
		} finally {
			await fileHandle?.close().catch(() => undefined);
		}
	}

	throw new Error('Mission daemon runtime lock could not be acquired.');
}

async function releaseDaemonRuntimeLock(lockPath: string): Promise<void> {
	const existingLock = await readDaemonRuntimeLock(lockPath);
	if (existingLock && existingLock.processId !== process.pid) {
		return;
	}

	await fs.rm(lockPath, { force: true }).catch(() => undefined);
}

async function readDaemonRuntimeLock(lockPath: string): Promise<DaemonRuntimeLock | undefined> {
	try {
		const content = await fs.readFile(lockPath, 'utf8');
		const parsed = JSON.parse(content) as Partial<DaemonRuntimeLock>;
		if (typeof parsed.processId !== 'number' || !Number.isInteger(parsed.processId) || parsed.processId <= 0) {
			return undefined;
		}
		return {
			lockPath,
			processId: parsed.processId,
			createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
			socketPath: typeof parsed.socketPath === 'string' ? parsed.socketPath : ''
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		return undefined;
	}
}

async function assertNoReachableDaemon(socketPath: string): Promise<void> {
	const manifest = await readDaemonManifest();
	const manifestSocketPath = manifest?.endpoint.transport === 'ipc' ? manifest.endpoint.path : undefined;
	const reachableDaemon = await probeDaemonSocket(manifestSocketPath ?? socketPath);
	if (!reachableDaemon) {
		return;
	}

	throw new Error(
		`Mission daemon is already running with pid ${String(reachableDaemon.pid)} at '${manifestSocketPath ?? socketPath}'. Stop it before starting another daemon.`
	);
}

async function probeDaemonSocket(socketPath: string): Promise<Ping | undefined> {
	try {
		return await new Promise<Ping | undefined>((resolve) => {
			const socket = net.createConnection(socketPath);
			let buffer = '';
			const timer = setTimeout(() => {
				socket.destroy();
				resolve(undefined);
			}, 500);

			const finish = (ping: Ping | undefined) => {
				clearTimeout(timer);
				socket.destroy();
				resolve(ping);
			};

			socket.setEncoding('utf8');
			socket.once('connect', () => {
				socket.write(`${JSON.stringify({ type: 'request', id: 'singleton-probe', method: 'ping' })}\n`);
			});
			socket.on('data', (chunk: string) => {
				buffer += chunk;
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex < 0) {
					return;
				}
				const line = buffer.slice(0, newlineIndex).trim();
				if (!line) {
					return;
				}
				const message = JSON.parse(line) as Response;
				finish(message.ok ? message.result as Ping : undefined);
			});
			socket.once('error', () => finish(undefined));
			socket.once('close', () => finish(undefined));
		});
	} catch {
		return undefined;
	}
}

function isProcessRunning(processId: number): boolean {
	try {
		process.kill(processId, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

async function terminateStaleDaemonProcess(processId: number): Promise<void> {
	if (processId === process.pid || !isProcessRunning(processId)) {
		return;
	}

	try {
		process.kill(processId, 'SIGTERM');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			throw error;
		}
		return;
	}

	const exited = await waitForProcessExit(processId, STALE_DAEMON_TERMINATION_TIMEOUT_MS);
	if (exited) {
		return;
	}

	try {
		process.kill(processId, 'SIGKILL');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			throw error;
		}
	}
}

async function waitForProcessExit(processId: number, timeoutMs: number): Promise<boolean> {
	const timeoutAt = Date.now() + timeoutMs;
	while (Date.now() < timeoutAt) {
		if (!isProcessRunning(processId)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !isProcessRunning(processId);
}

async function closeServer(server: net.Server): Promise<void> {
	await new Promise<void>((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});
}

function readSocketOverride(argv: string[]): string | undefined {
	const socketFlagIndex = argv.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? argv[socketFlagIndex + 1] : undefined;
	return socketPath?.trim() || undefined;
}

function resolveSurfacePath(surfacePath: string | undefined): string {
	return surfacePath?.trim() || process.env['MISSION_SURFACE_PATH']?.trim() || process.cwd();
}
