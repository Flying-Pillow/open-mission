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
import { EntityIdSchema } from '../entities/Entity/EntitySchema.js';
import { DaemonLogger } from './runtime/DaemonLogger.js';
import { MissionRegistry } from './MissionRegistry.js';

type NotificationAddress = {
	entityId: EntityIdType;
	eventName: string;
	missionEntityId?: EntityIdType;
};

type DaemonServices = {
	missionRegistry: MissionRegistry;
	notify?: (event: Notification) => void;
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

				void handleRequestLine(socket, line, startedAt, subscriptionsBySocket, { missionRegistry, notify: broadcastEvent });
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
		case 'stage.data.changed':
			return childAddress('stage', event.missionId, event.reference.stageId, 'data.changed');
		case 'task.data.changed':
			return childAddress('task', event.missionId, event.reference.taskId, 'data.changed');
		case 'artifact.data.changed':
			return {
				entityId: event.artifactEventLocator.id,
				eventName: 'data.changed',
				missionEntityId: createEntityId('mission', event.missionId)
			};
		case 'agentSession.data.changed':
			return childAddress('agent_session', event.missionId, event.reference.sessionId, 'data.changed');
		case 'entity.deleted':
			return {
				entityId: event.id,
				eventName: 'deleted'
			};
		case 'entity.changed':
			return {
				entityId: event.id,
				eventName: 'changed'
			};
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
		case 'stage.data.changed':
		case 'task.data.changed':
		case 'artifact.data.changed':
		case 'agentSession.data.changed':
		case 'entity.deleted':
		case 'entity.changed':
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
				const invocation = commandInvocation.success
					? commandInvocation.data
					: entityFormInvocationSchema.parse(request.params);
				const result = await executeEntityCommandInDaemon(
					invocation,
					{
						surfacePath: resolveSurfacePath(request.surfacePath),
						...(services.missionRegistry ? { missionRegistry: services.missionRegistry } : {}),
						...(authToken ? { authToken } : {})
					}
				);
				notifyEntityMutation(invocation, result, request, services);

				return {
					type: 'response',
					id: request.id,
					ok: true,
					result
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

function notifyEntityMutation(
	input: { entity: string; method: string },
	result: unknown,
	request: Request,
	services: Partial<DaemonServices>
): void {
	if (!services.notify || !isRecord(result)) {
		return;
	}
	const entityId = resolveMutationNotificationEntityId(input.entity, result);
	if (result['ok'] !== true || !entityId) {
		return;
	}

	try {
		if (input.method !== 'remove') {
			services.notify({
				type: 'entity.changed',
				workspaceRoot: resolveSurfacePath(request.surfacePath),
				entity: input.entity,
				id: entityId,
				method: input.method
			});
			return;
		}

		services.notify({
			type: 'entity.deleted',
			workspaceRoot: resolveSurfacePath(request.surfacePath),
			entity: input.entity,
			id: entityId
		});
	} catch {
		// Mutation notifications are best-effort; command success must stay authoritative.
	}
}

export function resolveMutationNotificationEntityId(entity: string, result: Record<string, unknown>): EntityIdType | undefined {
	const resultId = typeof result['id'] === 'string' ? result['id'].trim() : undefined;
	if (resultId) {
		const parsed = EntityIdSchema.safeParse(resultId);
		if (parsed.success) {
			return parsed.data;
		}
	}

	const missionId = typeof result['missionId'] === 'string' ? result['missionId'].trim() : undefined;
	switch (entity) {
		case 'Mission':
			return resultId ? createEntityId('mission', resultId) : undefined;
		case 'Stage': {
			const stageId = typeof result['stageId'] === 'string' ? result['stageId'].trim() : undefined;
			return missionId && stageId ? createEntityId('stage', `${missionId}/${stageId}`) : undefined;
		}
		case 'Task': {
			const taskId = typeof result['taskId'] === 'string' ? result['taskId'].trim() : undefined;
			return missionId && taskId ? createEntityId('task', `${missionId}/${taskId}`) : undefined;
		}
		case 'AgentSession': {
			const sessionId = typeof result['sessionId'] === 'string' ? result['sessionId'].trim() : undefined;
			return missionId && sessionId ? createEntityId('agent_session', `${missionId}/${sessionId}`) : undefined;
		}
		default:
			return undefined;
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readSocketOverride(argv: string[]): string | undefined {
	const socketFlagIndex = argv.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? argv[socketFlagIndex + 1] : undefined;
	return socketPath?.trim() || undefined;
}

function resolveSurfacePath(surfacePath: string | undefined): string {
	return surfacePath?.trim() || process.env['MISSION_SURFACE_PATH']?.trim() || process.cwd();
}