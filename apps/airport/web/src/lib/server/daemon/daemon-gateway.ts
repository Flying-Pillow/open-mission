// /apps/airport/web/src/lib/server/daemon/daemon-gateway.ts: Daemon-backed gateway for mission runtime, terminal, and document operations.
import type { Notification } from '@flying-pillow/mission-core/daemon/protocol/contracts';
import type { SystemState } from '@flying-pillow/mission-core/system/SystemContract';
import {
    createAllRuntimeEventSubscriptionChannels,
    createMissionRuntimeEventSubscriptionChannels
} from '@flying-pillow/mission-core/entities/Mission/MissionContract';
import {
    AgentExecutionTerminalSnapshotSchema,
    type AgentExecutionTerminalSnapshotType,
} from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import {
    MissionRuntimeEventEnvelopeSchema,
    MissionTerminalSnapshotSchema,
    type MissionRuntimeEventEnvelopeType,
    type MissionTerminalSnapshotType,
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    connectDedicatedAuthenticatedDaemonClient,
    connectSharedAuthenticatedDaemonClient,
    isRecoverableDaemonConnectionError,
    resetSharedAuthenticatedDaemonClient
} from './connections.server';
import type { AppContextServerValue } from '$lib/client/context/app-context.svelte';
import { readCachedDaemonSystemStatus } from './health.server';
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;

export type AirportSystemState = {
    appContext: AppContextServerValue;
    systemState?: SystemState;
};

export class DaemonGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public async getSystemState(): Promise<AirportSystemState> {
        return {
            appContext: this.getAppContext(),
            systemState: await readCachedDaemonSystemStatus({
                ...(this.locals ? { locals: this.locals } : {}),
            }),
        };
    }

    public async openEventSubscription(input: {
        missionId?: string;
        surfacePath?: string;
        onDisconnect?: () => void;
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
            input.onEvent(this.toRuntimeEventEnvelope(event));
        });
        const disconnectSubscription = daemon.client.onDidDisconnect(() => {
            input.onDisconnect?.();
        });

        return {
            dispose: () => {
                subscription.dispose();
                disconnectSubscription.dispose();
                daemon.dispose();
            }
        };
    }

    public async openApplicationEventSubscription(input: {
        channels: string[];
        surfacePath?: string;
        onDisconnect?: () => void;
        onEvent: (event: Notification) => void;
    }): Promise<{ dispose(): void }> {
        const daemon = await this.connectDedicatedDaemonClient(input.surfacePath);
        await daemon.client.request<null>('event.subscribe', {
            channels: input.channels
        });
        const subscription = daemon.client.onDidEvent((event) => {
            input.onEvent(event);
        });
        const disconnectSubscription = daemon.client.onDidDisconnect(() => {
            input.onDisconnect?.();
        });

        return {
            dispose: () => {
                subscription.dispose();
                disconnectSubscription.dispose();
                daemon.dispose();
            }
        };
    }

    public async getAgentExecutionTerminalSnapshot(input: {
        ownerId: string;
        agentExecutionId: string;
        surfacePath?: string;
    }): Promise<AgentExecutionTerminalSnapshotType> {
        return this.withSharedClient(input.surfacePath, async (daemon) => AgentExecutionTerminalSnapshotSchema.parse(
            await withTimeout(
                daemon.client.request('entity.query', {
                    entity: 'AgentExecution',
                    method: 'readTerminal',
                    payload: {
                        ownerId: input.ownerId,
                        agentExecutionId: input.agentExecutionId,
                    }
                }),
                2500,
                'AgentExecution terminal snapshot request timed out.'
            )
        ));
    }

    public async sendAgentExecutionTerminalInput(input: {
        ownerId: string;
        agentExecutionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<AgentExecutionTerminalSnapshotType> {
        return this.withSharedClient(input.surfacePath, async (daemon) => AgentExecutionTerminalSnapshotSchema.parse(
            await withTimeout(
                daemon.client.request('entity.command', {
                    entity: 'AgentExecution',
                    method: 'sendTerminalInput',
                    payload: {
                        ownerId: input.ownerId,
                        agentExecutionId: input.agentExecutionId,
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {}),
                    }
                }),
                2500,
                'AgentExecution terminal input request timed out.'
            )
        ));
    }

    public async getMissionTerminalSnapshot(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshotType> {
        return this.withSharedClient(input.surfacePath, async (daemon) => MissionTerminalSnapshotSchema.parse(
            await withTimeout(
                daemon.client.request('entity.command', {
                    entity: 'Mission',
                    method: 'ensureTerminal',
                    payload: { missionId: input.missionId }
                }),
                2500,
                'Mission terminal snapshot request timed out.'
            )
        ));
    }

    public async sendMissionTerminalInput(input: {
        missionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshotType> {
        return this.withSharedClient(input.surfacePath, async (daemon) => MissionTerminalSnapshotSchema.parse(
            await withTimeout(
                daemon.client.request('entity.command', {
                    entity: 'Mission',
                    method: 'sendTerminalInput',
                    payload: {
                        missionId: input.missionId,
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {}),
                    }
                }),
                2500,
                'Mission terminal input request timed out.'
            )
        ));
    }

    private toRuntimeEventEnvelope(event: Notification): MissionRuntimeEventEnvelopeType {
        return MissionRuntimeEventEnvelopeSchema.parse(event);
    }

    private async withSharedClient<T>(
        surfacePath: string | undefined,
        execute: (daemon: Awaited<ReturnType<DaemonGateway['connectSharedDaemonClient']>>) => Promise<T>
    ): Promise<T> {
        try {
            return await this.withSharedClientLease(surfacePath, execute);
        } catch (error) {
            if (!isRecoverableDaemonConnectionError(error)) {
                throw error;
            }
            resetSharedAuthenticatedDaemonClient({
                locals: this.locals,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            });
            return this.withSharedClientLease(surfacePath, execute);
        }
    }

    private async withSharedClientLease<T>(
        surfacePath: string | undefined,
        execute: (daemon: Awaited<ReturnType<DaemonGateway['connectSharedDaemonClient']>>) => Promise<T>
    ): Promise<T> {
        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            return await execute(daemon);
        } finally {
            daemon.dispose();
        }
    }

    private async connectSharedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
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
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }

    private getAppContext(): AppContextServerValue {
        return this.locals?.appContext ?? {
            daemon: {
                running: false,
                message: 'Mission daemon state is unavailable.',
                lastCheckedAt: new Date(0).toISOString(),
            },
            githubStatus: 'unknown',
        };
    }

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
