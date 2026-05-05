import { dev } from '$app/environment';
import { DaemonApi } from '@flying-pillow/mission-core/daemon/client/DaemonApi';
import type { EntityCommandInvocation, EntityFormInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import {
    connectSharedAuthenticatedDaemonClient,
    isRecoverableDaemonConnectionError,
    resetSharedAuthenticatedDaemonClient
} from './connections.server';

const ENTITY_REQUEST_TIMEOUT_MS = 8_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;
const SLOW_ENTITY_REMOTE_REQUEST_MS = 1_000;

export class EntityProxy {
    public constructor(private readonly locals?: App.Locals) { }

    public async executeEntityQuery(input: EntityQueryInvocation): Promise<EntityRemoteResult> {
        return this.executeWithReconnect(input, async () => {
            const daemon = await this.connectSharedDaemonClient();
            try {
                const api = new DaemonApi(daemon.client);
                return await withTimeout(
                    api.entity.query(input),
                    ENTITY_REQUEST_TIMEOUT_MS,
                    `Entity query '${input.method}' timed out.`
                );
            } finally {
                daemon.dispose();
            }
        });
    }

    public async executeEntityCommand(input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult> {
        return this.executeWithReconnect(input, async () => {
            const daemon = await this.connectSharedDaemonClient();
            try {
                const api = new DaemonApi(daemon.client);
                return await withTimeout(
                    api.entity.command(input),
                    ENTITY_REQUEST_TIMEOUT_MS,
                    `Entity command '${input.method}' timed out.`
                );
            } finally {
                daemon.dispose();
            }
        });
    }

    private async executeWithReconnect(
        input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
        operation: () => Promise<EntityRemoteResult>
    ): Promise<EntityRemoteResult> {
        const startedAt = performance.now();
        let retried = false;
        try {
            return await operation();
        } catch (error) {
            if (!isRecoverableDaemonConnectionError(error)) {
                throw error;
            }
            retried = true;
            resetSharedAuthenticatedDaemonClient({ locals: this.locals });
            return operation();
        } finally {
            const durationMs = performance.now() - startedAt;
            if (dev && durationMs >= SLOW_ENTITY_REMOTE_REQUEST_MS) {
                console.warn('[airport-web] slow entity remote request', {
                    entity: input.entity,
                    method: input.method,
                    durationMs: Math.round(durationMs),
                    retried
                });
            }
        }
    }

    private async connectSharedDaemonClient() {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(message));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}