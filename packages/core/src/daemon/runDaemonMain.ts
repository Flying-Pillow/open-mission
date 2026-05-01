import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import {
	getDaemonManifestPath,
	getDaemonRuntimePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';
import {
	type EventSubscription,
	type AddressedNotification,
	type Notification
} from './protocol/contracts.js';
import {
	PROTOCOL_VERSION,
	type Manifest,
	type Ping,
	type Request,
	type Response
} from './protocol/transport.js';
import {
	createEntityChannel,
	createEntityId,
	matchesEntityChannel,
	type EntityIdType
} from '../entities/Entity/Entity.js';
import { DaemonLogger } from './runtime/DaemonLogger.js';
import { MissionRegistry } from './MissionRegistry.js';

type NotificationAddress = {
	entityId: EntityIdType;
	eventName: string;
	missionEntityId?: EntityIdType;
};

type DaemonServices = {
	missionRegistry: MissionRegistry;
};
import {
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from './entityRemote.js';
import {
	observeMissionTerminalUpdates
} from './MissionTerminal.js';
import {
	observeAgentSessionTerminalUpdates
} from './AgentSessionTerminal.js';

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const socketPath = resolveDaemonSocketPath(readSocketOverride(argv));
	const manifestPath = getDaemonManifestPath();
	const startedAt = new Date().toISOString();
	const logger = new DaemonLogger();
	const missionRegistry = new MissionRegistry({ logger });
	const sockets = new Set<net.Socket>();
	const subscriptionsBySocket = new Map<net.Socket, EventSubscription[]>();
	let shuttingDown = false;
	const missionTerminalUpdates = observeMissionTerminalUpdates((event) => {
		broadcastEvent({
			type: 'mission.terminal',
			workspaceRoot: event.workspaceRoot,
			missionId: event.missionId,
			state: event.state,
		});
	});
	const sessionTerminalUpdates = observeAgentSessionTerminalUpdates((event) => {
		broadcastEvent({
			type: 'session.terminal',
			missionId: event.missionId,
			sessionId: event.sessionId,
			state: event.state,
		});
	});

	await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
	logger.info('Mission daemon starting.', { pid: process.pid, socketPath });
	await missionRegistry.hydrateDaemonMissions({ surfacePath: resolveSurfacePath(undefined) });
	logger.info('Mission daemon hydration completed.');
	if (!isNamedPipePath(socketPath)) {
		await fs.rm(socketPath, { force: true }).catch(() => undefined);
	}

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

				void handleRequestLine(socket, line, startedAt, subscriptionsBySocket, { missionRegistry });
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

	const broadcastEvent = (event: Notification): void => {
		const addressedEvent = addressNotification(event);
		for (const socket of sockets) {
			if (socket.destroyed) {
				continue;
			}
			const subscriptions = subscriptionsBySocket.get(socket) ?? [];
			if (!subscriptions.some((subscription) => matchesSubscription(subscription, addressedEvent))) {
				continue;
			}
			try {
				socket.write(`${JSON.stringify({ type: 'event', event: addressedEvent })}\n`);
			} catch {
				socket.destroy();
			}
		}
	};

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
		missionTerminalUpdates.dispose();
		sessionTerminalUpdates.dispose();
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
		await logger.flush();
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

async function handleRequestLine(
	socket: net.Socket,
	line: string,
	startedAt: string,
	subscriptionsBySocket: Map<net.Socket, EventSubscription[]>,
	services: DaemonServices
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

	const response = await createResponse(request, startedAt, services);
	if (!socket.destroyed) {
		try {
			socket.write(`${JSON.stringify(response)}\n`);
			registerSubscription(socket, request, subscriptionsBySocket);
		} catch {
			socket.destroy();
		}
	}
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

function matchesSubscription(subscription: EventSubscription, event: AddressedNotification): boolean {
	return subscription.channels?.some((channel) => matchesEntityChannel(event.channel, channel)) ?? false;
}

function addressNotification(event: Notification): AddressedNotification {
	const address = resolveNotificationAddress(event);
	return {
		...event,
		...address,
		channel: createEntityChannel(address.entityId, address.eventName),
		occurredAt: resolveNotificationOccurredAt(event)
	};
}

function resolveNotificationAddress(event: Notification): NotificationAddress {
	switch (event.type) {
		case 'mission.snapshot.changed':
			return missionAddress(event.missionId, 'snapshot.changed');
		case 'mission.status':
			return missionAddress(event.missionId, 'status');
		case 'mission.terminal':
			return missionAddress(event.missionId, 'terminal');
		case 'stage.snapshot.changed':
			return childAddress('stage', event.missionId, event.reference.stageId, 'snapshot.changed');
		case 'task.snapshot.changed':
			return childAddress('task', event.missionId, event.reference.taskId, 'snapshot.changed');
		case 'artifact.snapshot.changed':
			return childAddress('artifact', event.missionId, event.reference.artifactId, 'snapshot.changed');
		case 'agentSession.snapshot.changed':
			return childAddress('agent_session', event.missionId, event.reference.sessionId, 'snapshot.changed');
		case 'session.console':
			return childAddress('agent_session', event.missionId, event.sessionId, 'console');
		case 'session.terminal':
			return childAddress('agent_session', event.missionId, event.sessionId, 'terminal');
		case 'session.event':
			return childAddress('agent_session', event.missionId, event.sessionId, 'event');
		case 'session.lifecycle':
			return childAddress('agent_session', event.missionId, event.sessionId, 'lifecycle');
		case 'control.workflow.settings.updated':
			return {
				entityId: createEntityId('control', 'workflow-settings'),
				eventName: 'updated'
			};
	}
}

function missionAddress(missionId: string, eventName: string): NotificationAddress {
	const entityId = createEntityId('mission', missionId);
	return {
		entityId,
		eventName,
		missionEntityId: entityId
	};
}

function childAddress(
	table: string,
	missionId: string,
	childId: string,
	eventName: string
): NotificationAddress {
	return {
		entityId: createEntityId(table, `${missionId}/${childId}`),
		eventName,
		missionEntityId: createEntityId('mission', missionId)
	};
}

function resolveNotificationOccurredAt(event: Notification): string {
	switch (event.type) {
		case 'mission.snapshot.changed':
			return event.snapshot.workflow?.updatedAt
				?? event.snapshot.status?.workflow?.updatedAt
				?? new Date().toISOString();
		case 'mission.status':
			return event.status.workflow?.updatedAt ?? new Date().toISOString();
		case 'session.event':
			return event.session.lastUpdatedAt ?? new Date().toISOString();
		case 'stage.snapshot.changed':
		case 'task.snapshot.changed':
		case 'artifact.snapshot.changed':
		case 'agentSession.snapshot.changed':
		case 'session.console':
		case 'mission.terminal':
		case 'session.terminal':
		case 'session.lifecycle':
		case 'control.workflow.settings.updated':
			return new Date().toISOString();
	}
}

export async function createResponse(
	request: Request,
	startedAt: string,
	services: Partial<DaemonServices> = {}
): Promise<Response> {
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
			case 'event.subscribe': {
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result: null,
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
				const { entityQueryInvocationSchema } = await import('./protocol/entityRemote.js');
				const authToken = request.authToken?.trim();
				return {
					type: 'response',
					id: request.id,
					ok: true,
					result: await executeEntityQueryInDaemon(
						entityQueryInvocationSchema.parse(request.params),
						{
							surfacePath: resolveSurfacePath(request.surfacePath),
							...(services.missionRegistry ? { missionRegistry: services.missionRegistry } : {}),
							...(authToken ? { authToken } : {})
						}
					)
				};
			}
			case 'entity.command': {
				const {
					entityCommandInvocationSchema,
					entityFormInvocationSchema
				} = await import('./protocol/entityRemote.js');
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
							...(services.missionRegistry ? { missionRegistry: services.missionRegistry } : {}),
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