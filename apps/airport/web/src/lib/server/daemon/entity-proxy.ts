import { DaemonApi } from '@flying-pillow/mission-core/node';
import type { EntityCommandInvocation, EntityFormInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';
import { connectSharedAuthenticatedDaemonClient } from './connections.server';

const ENTITY_REQUEST_TIMEOUT_MS = 8_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;

export class EntityProxy {
    public constructor(private readonly locals?: App.Locals) { }

    public async executeEntityQuery(input: EntityQueryInvocation): Promise<EntityRemoteResult> {
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
    }

    public async executeEntityCommand(input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult> {
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
    }

    private async connectSharedDaemonClient() {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true
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