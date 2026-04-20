// /apps/airport/web/src/lib/server/daemon/shared-client.server.ts: Reuses short-lived daemon connections across SvelteKit request handlers.
import type { DaemonClient } from '@flying-pillow/mission-core';
import { openDaemonConnection } from './transport.server';

const DAEMON_CLIENT_IDLE_TIMEOUT_MS = 15_000;

type SharedDaemonClientEntry = {
    clientPromise: Promise<DaemonClient>;
    client?: DaemonClient;
    activeLeases: number;
    idleTimer?: ReturnType<typeof setTimeout>;
};

const sharedDaemonClients = new Map<string, SharedDaemonClientEntry>();

export function clearSharedDaemonClient(surfacePath: string, authToken?: string): void {
    const key = createDaemonClientKey(surfacePath, authToken);
    const entry = sharedDaemonClients.get(key);
    if (!entry) {
        return;
    }

    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
    }
    sharedDaemonClients.delete(key);
    entry.client?.dispose();
}

export async function acquireSharedDaemonClient(input: {
    surfacePath: string;
    allowStart: boolean;
    authToken?: string;
}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const key = createDaemonClientKey(input.surfacePath, input.authToken);
    let entry = sharedDaemonClients.get(key);
    if (!entry) {
        const newEntry: SharedDaemonClientEntry = {
            clientPromise: openDaemonConnection({
                surfacePath: input.surfacePath,
                allowStart: input.allowStart,
                ...(input.authToken ? { authToken: input.authToken } : {})
            }).then((connection) => connection.client),
            activeLeases: 0
        };
        sharedDaemonClients.set(key, newEntry);
        newEntry.clientPromise = newEntry.clientPromise.then(
            (client) => {
                newEntry.client = client;
                return client;
            },
            (error) => {
                sharedDaemonClients.delete(key);
                throw error;
            }
        );
        entry = newEntry;
    }

    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = undefined;
    }

    entry.activeLeases += 1;
    let client: DaemonClient;
    try {
        client = await entry.clientPromise;
        await client.connect({ surfacePath: input.surfacePath });
    } catch (error) {
        sharedDaemonClients.delete(key);
        entry.client?.dispose();
        throw error;
    }

    let disposed = false;
    return {
        client,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;

            const currentEntry = sharedDaemonClients.get(key);
            if (!currentEntry) {
                return;
            }

            currentEntry.activeLeases = Math.max(0, currentEntry.activeLeases - 1);
            if (currentEntry.activeLeases > 0 || currentEntry.idleTimer) {
                return;
            }

            currentEntry.idleTimer = setTimeout(() => {
                const idleEntry = sharedDaemonClients.get(key);
                if (!idleEntry || idleEntry.activeLeases > 0) {
                    return;
                }

                sharedDaemonClients.delete(key);
                idleEntry.client?.dispose();
            }, DAEMON_CLIENT_IDLE_TIMEOUT_MS);
        }
    };
}

function createDaemonClientKey(surfacePath: string, authToken?: string): string {
    return JSON.stringify({
        surfacePath,
        authToken: authToken?.trim() || ''
    });
}