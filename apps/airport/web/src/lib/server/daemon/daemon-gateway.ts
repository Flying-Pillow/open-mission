// /apps/airport/web/src/lib/server/daemon/daemon-gateway.ts: Daemon-backed gateway for mission runtime, terminal, and document operations.
import { randomUUID } from 'node:crypto';
import {
    DaemonApi,
    type Notification,
} from '@flying-pillow/mission-core/node';
import {
    createAllRuntimeEventSubscriptionChannels,
    createMissionRuntimeEventSubscriptionChannels
} from '@flying-pillow/mission-core/entities/Mission/MissionContract';
import {
    AgentSessionTerminalSnapshotSchema,
    type AgentSessionDataType,
    type AgentSessionTerminalSnapshotType,
} from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import {
    MissionRuntimeEventEnvelopeSchema,
    MissionTerminalSnapshotSchema,
    type MissionRuntimeEventEnvelopeType,
    type MissionTerminalSnapshotType,
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { RepositoryDataSchema, RepositoryStorageSchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { RepositoryStorageType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import {
    connectDedicatedAuthenticatedDaemonClient,
    connectSharedAuthenticatedDaemonClient
} from './connections.server';
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;

type AddressedNotification = Notification & {
    entityId: string;
    channel: string;
    eventName: string;
    occurredAt: string;
    missionEntityId?: string;
};

export class DaemonGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public async openEventSubscription(input: {
        missionId?: string;
        surfacePath?: string;
        onEvent: (event: MissionRuntimeEventEnvelopeType) => void;
    }): Promise<{ dispose(): void }> {
        const missionId = input.missionId?.trim();
        const daemon = await this.connectDedicatedDaemonClient(input.surfacePath);
        await daemon.client.request<null>('event.subscribe', {
            channels: missionId
                ? createMissionRuntimeEventSubscriptionChannels(missionId)
                : createAllRuntimeEventSubscriptionChannels()
        });
        const subscription = daemon.client.onDidEvent((event) => {
            input.onEvent(this.toRuntimeEventEnvelope(toAddressedNotification(event)));
        });

        return {
            dispose: () => {
                subscription.dispose();
                daemon.dispose();
            }
        };
    }

    public async openApplicationEventSubscription(input: {
        channels: string[];
        surfacePath?: string;
        onEvent: (event: AddressedNotification) => void;
    }): Promise<{ dispose(): void }> {
        const daemon = await this.connectDedicatedDaemonClient(input.surfacePath);
        await daemon.client.request<null>('event.subscribe', {
            channels: input.channels
        });
        const subscription = daemon.client.onDidEvent((event) => {
            input.onEvent(toAddressedNotification(event));
        });

        return {
            dispose: () => {
                subscription.dispose();
                daemon.dispose();
            }
        };
    }

    public async getMissionSessionTerminalSnapshot(input: {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
    }): Promise<AgentSessionTerminalSnapshotType> {
        return this.queryEntity({
            surfacePath: input.surfacePath,
            entity: 'AgentSession',
            method: 'readTerminal',
            payload: {
                missionId: input.missionId,
                sessionId: input.sessionId,
            },
            parse: (value) => AgentSessionTerminalSnapshotSchema.parse(value),
            timeoutMessage: 'Mission terminal snapshot request timed out.',
        });
    }

    public async sendMissionSessionTerminalInput(input: {
        missionId: string;
        sessionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<AgentSessionTerminalSnapshotType> {
        return this.commandEntity({
            surfacePath: input.surfacePath,
            entity: 'AgentSession',
            method: 'sendTerminalInput',
            payload: {
                missionId: input.missionId,
                sessionId: input.sessionId,
                ...(input.data !== undefined ? { data: input.data } : {}),
                ...(input.literal !== undefined ? { literal: input.literal } : {}),
                ...(input.cols !== undefined ? { cols: input.cols } : {}),
                ...(input.rows !== undefined ? { rows: input.rows } : {}),
            },
            parse: (value) => AgentSessionTerminalSnapshotSchema.parse(value),
            timeoutMessage: 'Mission terminal input request timed out.',
        });
    }

    public async getMissionTerminalSnapshot(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshotType> {
        return this.commandEntity({
            surfacePath: input.surfacePath,
            entity: 'Mission',
            method: 'ensureTerminal',
            payload: { missionId: input.missionId },
            parse: (value) => MissionTerminalSnapshotSchema.parse(value),
            timeoutMessage: 'Mission terminal snapshot request timed out.',
        });
    }

    public async sendMissionTerminalInput(input: {
        missionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshotType> {
        return this.commandEntity({
            surfacePath: input.surfacePath,
            entity: 'Mission',
            method: 'sendTerminalInput',
            payload: {
                missionId: input.missionId,
                ...(input.data !== undefined ? { data: input.data } : {}),
                ...(input.literal !== undefined ? { literal: input.literal } : {}),
                ...(input.cols !== undefined ? { cols: input.cols } : {}),
                ...(input.rows !== undefined ? { rows: input.rows } : {}),
            },
            parse: (value) => MissionTerminalSnapshotSchema.parse(value),
            timeoutMessage: 'Mission terminal input request timed out.',
        });
    }

    private toRuntimeEventEnvelope(event: AddressedNotification): MissionRuntimeEventEnvelopeType {
        return MissionRuntimeEventEnvelopeSchema.parse({
            eventId: randomUUID(),
            entityId: event.entityId,
            channel: event.channel,
            eventName: event.eventName,
            type: event.type,
            occurredAt: event.occurredAt,
            ...(notificationMissionId(event) ? { missionId: notificationMissionId(event) } : {}),
            payload: this.toRuntimeEventPayload(event)
        });
    }

    private toRuntimeEventPayload(event: AddressedNotification): unknown {
        switch (event.type) {
            case 'mission.snapshot.changed':
                return {
                    reference: event.reference,
                    snapshot: event.snapshot
                };
            case 'stage.data.changed':
            case 'task.data.changed':
            case 'agentSession.data.changed':
                return {
                    reference: event.reference,
                    data: event.data
                };
            case 'artifact.data.changed':
                return {
                    artifactEventLocator: event.artifactEventLocator,
                    data: event.data
                };
            case 'mission.status':
                return event.status;
            case 'session.event':
                return event.session;
            case 'session.lifecycle':
                return {
                    phase: event.phase,
                    lifecycleState: event.lifecycleState
                };
            case 'session.console':
            case 'mission.terminal':
            case 'session.terminal':
            case 'control.workflow.settings.updated':
                return event;
        }
    }

    public async resolveRepositoryCandidate(input: {
        id: string;
    }): Promise<RepositoryStorageType> {
        const id = input.id.trim();
        if (!id) {
            throw new Error('Repository access requires an id.');
        }

        try {
            const data = await this.queryEntity({
                entity: 'Repository',
                method: 'read',
                payload: { id },
                parse: (value) => RepositoryDataSchema.parse(value),
                timeoutMessage: `Repository '${id}' read timed out.`,
            });

            return RepositoryStorageSchema.parse({
                id: data.id,
                repositoryRootPath: data.repositoryRootPath,
                ownerId: data.ownerId,
                repoName: data.repoName,
                ...(data.platformRepositoryRef ? { platformRepositoryRef: data.platformRepositoryRef } : {}),
                settings: data.settings,
                workflowConfiguration: data.workflowConfiguration,
                isInitialized: data.isInitialized,
            });
        } catch (error) {
            if (error instanceof Error && /not found/i.test(error.message)) {
                throw new Error(`Repository '${id}' could not be resolved in Airport.`);
            }
            throw error;
        }
    }

    private async queryEntity<T>(input: {
        surfacePath?: string;
        entity: string;
        method: string;
        payload: Record<string, unknown>;
        parse: (value: unknown) => T;
        timeoutMessage: string;
    }): Promise<T> {
        return this.withSharedApi(input.surfacePath, async (api) => input.parse(await withTimeout(
            api.entity.query({
                entity: input.entity,
                method: input.method,
                payload: input.payload,
            }),
            2500,
            input.timeoutMessage,
        )));
    }

    private async commandEntity<T>(input: {
        surfacePath?: string;
        entity: string;
        method: string;
        payload: Record<string, unknown>;
        parse: (value: unknown) => T;
        timeoutMessage: string;
    }): Promise<T> {
        return this.withSharedApi(input.surfacePath, async (api) => input.parse(await withTimeout(
            api.entity.command({
                entity: input.entity,
                method: input.method,
                payload: input.payload,
            }),
            2500,
            input.timeoutMessage,
        )));
    }

    private async withSharedApi<T>(surfacePath: string | undefined, execute: (api: DaemonApi) => Promise<T>): Promise<T> {
        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            return await execute(new DaemonApi(daemon.client));
        } finally {
            daemon.dispose();
        }
    }

    private async connectSharedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }

    private async connectDedicatedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectDedicatedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }

}

function notificationMissionId(event: AddressedNotification): string | undefined {
    return 'missionId' in event ? event.missionId : undefined;
}

function toAddressedNotification(event: Notification): AddressedNotification {
    if (!hasAddressMetadata(event)) {
        throw new Error(`Daemon event '${event.type}' did not include entity channel metadata.`);
    }
    return event;
}

function hasAddressMetadata(event: Notification): event is AddressedNotification {
    const candidate = event as Partial<AddressedNotification>;
    return typeof candidate.entityId === 'string' && candidate.entityId.trim().length > 0
        && typeof candidate.channel === 'string' && candidate.channel.trim().length > 0
        && typeof candidate.eventName === 'string' && candidate.eventName.trim().length > 0
        && typeof candidate.occurredAt === 'string' && candidate.occurredAt.trim().length > 0;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}