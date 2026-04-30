// /apps/airport/web/src/lib/server/daemon/daemon-gateway.ts: Daemon-backed gateway for mission runtime, terminal, and document operations.
import { randomUUID } from 'node:crypto';
import {
    DaemonApi,
    type Notification,
    type AgentSessionState,
    type MissionEntity,
} from '@flying-pillow/mission-core/node';
import { agentSessionSnapshotSchema, agentSessionTerminalSnapshotSchema } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { AgentSessionSnapshot as AgentSession, AgentSessionTerminalSnapshot as MissionSessionTerminalSnapshot } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import { missionTerminalSnapshotSchema } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { MissionTerminalSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { RepositorySnapshotSchema, RepositorySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { RepositoryDataType as Repository } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import {
    airportRuntimeEventEnvelopeSchema,
    type AirportRuntimeEventEnvelope
} from '../../contracts/runtime-events';
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
        onEvent: (event: AirportRuntimeEventEnvelope) => void;
    }): Promise<{ dispose(): void }> {
        const missionId = input.missionId?.trim();
        const daemon = await this.connectDedicatedDaemonClient(input.surfacePath);
        await daemon.client.request<null>('event.subscribe', {
            channels: missionId ? missionRuntimeEventChannels(missionId) : allRuntimeEventChannels()
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

    public async getMissionSessionTerminalSnapshot(input: {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
    }): Promise<MissionSessionTerminalSnapshot> {
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return agentSessionTerminalSnapshotSchema.parse(await withTimeout(
                api.entity.query({
                    entity: 'AgentSession',
                    method: 'readTerminal',
                    payload: {
                        missionId: input.missionId,
                        sessionId: input.sessionId
                    }
                }),
                2500,
                'Mission terminal snapshot request timed out.'
            ));
        } finally {
            daemon.dispose();
        }
    }

    public async sendMissionSessionTerminalInput(input: {
        missionId: string;
        sessionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionSessionTerminalSnapshot> {
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return agentSessionTerminalSnapshotSchema.parse(await withTimeout(
                api.entity.command({
                    entity: 'AgentSession',
                    method: 'sendTerminalInput',
                    payload: {
                        missionId: input.missionId,
                        sessionId: input.sessionId,
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {})
                    }
                }),
                2500,
                'Mission terminal input request timed out.'
            ));
        } finally {
            daemon.dispose();
        }
    }

    public async getMissionTerminalSnapshot(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshot> {
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return missionTerminalSnapshotSchema.parse(await withTimeout(
                api.entity.command({
                    entity: 'Mission',
                    method: 'ensureTerminal',
                    payload: { missionId: input.missionId }
                }),
                2500,
                'Mission terminal snapshot request timed out.'
            ));
        } finally {
            daemon.dispose();
        }
    }

    public async sendMissionTerminalInput(input: {
        missionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshot> {
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return missionTerminalSnapshotSchema.parse(await withTimeout(
                api.entity.command({
                    entity: 'Mission',
                    method: 'sendTerminalInput',
                    payload: {
                        missionId: input.missionId,
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {})
                    }
                }),
                2500,
                'Mission terminal input request timed out.'
            ));
        } finally {
            daemon.dispose();
        }
    }

    private toRuntimeEventEnvelope(event: AddressedNotification): AirportRuntimeEventEnvelope {
        return airportRuntimeEventEnvelopeSchema.parse({
            eventId: randomUUID(),
            entityId: event.entityId,
            channel: event.channel,
            eventName: event.eventName,
            type: event.type,
            occurredAt: event.occurredAt,
            ...(notificationMissionId(event) ? { missionId: notificationMissionId(event) } : {}),
            payload: this.toRuntimeEventPayload(event)
        }) as AirportRuntimeEventEnvelope;
    }

    private toRuntimeEventPayload(event: AddressedNotification): unknown {
        switch (event.type) {
            case 'airport.state':
                return { system: event.system };
            case 'mission.snapshot.changed':
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
                return {
                    reference: event.reference,
                    snapshot: event.snapshot
                };
            case 'mission.actions.changed':
                return {
                    missionId: event.missionId,
                    ...(event.reference ? { reference: event.reference } : {}),
                    ...(event.actions ? { actions: event.actions } : {}),
                    ...(event.revision ? { revision: event.revision } : {})
                };
            case 'mission.status':
                return {
                    missionId: event.missionId,
                    status: this.toMissionStatusSummary(event.status, event.missionId)
                };
            case 'session.event':
                return {
                    missionId: event.missionId,
                    sessionId: event.sessionId,
                    session: this.toMissionSessionSnapshot(event.event.state)
                };
            case 'session.lifecycle':
                return {
                    missionId: event.missionId,
                    sessionId: event.sessionId,
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

    private toMissionStatusSummary(mission: MissionEntity, missionId: string) {
        return {
            missionId: mission.missionId.trim() || missionId,
            ...(mission.title ? { title: mission.title } : {}),
            ...(mission.issueId !== undefined ? { issueId: mission.issueId } : {}),
            ...(mission.type ? { type: mission.type } : {}),
            ...(mission.operationalMode ? { operationalMode: mission.operationalMode } : {}),
            ...(mission.branchRef ? { branchRef: mission.branchRef } : {}),
            ...(mission.missionDir ? { missionDir: mission.missionDir } : {}),
            ...(mission.missionRootDir ? { missionRootDir: mission.missionRootDir } : {}),
            ...(mission.artifacts.length > 0 ? { artifacts: structuredClone(mission.artifacts) } : {}),
            ...(mission.lifecycle || mission.updatedAt || mission.currentStageId || mission.stages.length > 0
                ? {
                    workflow: {
                        ...(mission.lifecycle ? { lifecycle: mission.lifecycle } : {}),
                        ...(mission.updatedAt ? { updatedAt: mission.updatedAt } : {}),
                        ...(mission.currentStageId ? { currentStageId: mission.currentStageId } : {}),
                        stages: mission.stages.map((stage) => structuredClone(stage))
                    }
                }
                : {}),
            ...(mission.recommendedAction ? { recommendedAction: mission.recommendedAction } : {})
        };
    }

    private toMissionSessionSnapshot(session: AgentSession | AgentSessionState): AgentSession {
        return agentSessionSnapshotSchema.parse({
            sessionId: session.sessionId,
            runnerId: session.runnerId,
            ...(session.transportId ? { transportId: session.transportId } : {}),
            runnerLabel: session.runnerLabel,
            ...(session.sessionLogPath ? { sessionLogPath: session.sessionLogPath } : {}),
            lifecycleState: session.lifecycleState,
            ...(session.terminalSessionName ? { terminalSessionName: session.terminalSessionName } : {}),
            ...(session.terminalPaneId ? { terminalPaneId: session.terminalPaneId } : {}),
            ...(session.terminalSessionName && session.terminalPaneId
                ? {
                    terminalHandle: {
                        sessionName: session.terminalSessionName,
                        paneId: session.terminalPaneId
                    }
                }
                : {}),
            ...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
            ...(session.currentTurnTitle ? { currentTurnTitle: session.currentTurnTitle } : {}),
            ...('taskId' in session && session.taskId ? { taskId: session.taskId } : {})
        });
    }

    public async resolveRepositoryCandidate(input: {
        id: string;
    }): Promise<Repository> {
        const id = input.id.trim();
        if (!id) {
            throw new Error('Repository access requires an id.');
        }

        const daemon = await this.connectSharedDaemonClient();
        try {
            const api = new DaemonApi(daemon.client);
            const snapshot = RepositorySnapshotSchema.parse(
                await withTimeout(
                    api.entity.query({
                        entity: 'Repository',
                        method: 'read',
                        payload: { id }
                    }),
                    2500,
                    `Repository '${id}' read timed out.`
                )
            );

            return this.toRepositorySnapshot(snapshot.repository);
        } catch (error) {
            if (error instanceof Error && /not found/i.test(error.message)) {
                throw new Error(`Repository '${id}' could not be resolved in Airport.`);
            }
            throw error;
        } finally {
            daemon.dispose();
        }
    }

    private toRepositorySnapshot(repository: Repository): Repository {
        return RepositorySchema.parse(repository);
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

function clipTerminalScreen(screen: string): { screen: string; truncated: boolean } {
    if (screen.length <= AIRPORT_WEB_TERMINAL_SCREEN_LIMIT) {
        return { screen, truncated: false };
    }

    return {
        screen: screen.slice(-AIRPORT_WEB_TERMINAL_SCREEN_LIMIT),
        truncated: true
    };
}

function missionRuntimeEventChannels(missionId: string): string[] {
    return [
        `mission:${missionId}.snapshot.changed`,
        `mission:${missionId}.actions.changed`,
        `mission:${missionId}.status`,
        `stage:${missionId}/*.*`,
        `task:${missionId}/*.*`,
        `artifact:${missionId}/*.*`,
        `agent_session:${missionId}/*.snapshot.changed`,
        `agent_session:${missionId}/*.event`,
        `agent_session:${missionId}/*.lifecycle`
    ];
}

function allRuntimeEventChannels(): string[] {
    return [
        'airport:state.changed',
        'mission:*',
        'stage:*',
        'task:*',
        'artifact:*',
        'agent_session:*.snapshot.changed',
        'agent_session:*.event',
        'agent_session:*.lifecycle'
    ];
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