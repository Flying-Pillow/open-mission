// /apps/airport/web/src/lib/server/daemon/connections.server.ts: Public daemon connection entrypoints for Airport web gateway code.
import type { DaemonClient } from '@flying-pillow/mission-core';
import { resolveRequestAuthToken, resolveSurfacePath } from './context.server';
import {
    DaemonUnavailableError,
    getDaemonRuntimeState,
    isDaemonUnavailableError
} from './health.server';
import { acquireSharedDaemonClient, clearSharedDaemonClient } from './shared-client.server';
import { openDaemonConnection } from './transport.server';

export async function connectSharedAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    allowStart?: boolean;
    surfacePath?: string;
} = {}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const allowStart = input.allowStart ?? false;

    try {
        if (allowStart) {
            const daemonState = await getDaemonRuntimeState({
                surfacePath,
                allowStart,
                ...(authToken ? { authToken } : {}),
                ...(input.locals ? { locals: input.locals } : {})
            });
            if (!daemonState.running) {
                throw new DaemonUnavailableError(daemonState);
            }
        }

        const lease = await acquireSharedDaemonClient({
            surfacePath,
            allowStart: false,
            ...(authToken ? { authToken } : {})
        });

        return {
            client: lease.client,
            dispose: lease.dispose
        };
    } catch (error) {
        if (allowStart && !isDaemonUnavailableError(error)) {
            clearSharedDaemonClient(surfacePath, authToken);
            const daemonState = await getDaemonRuntimeState({
                surfacePath,
                allowStart,
                ...(authToken ? { authToken } : {}),
                ...(input.locals ? { locals: input.locals } : {})
            });
            if (!daemonState.running) {
                throw new DaemonUnavailableError(daemonState);
            }

            const lease = await acquireSharedDaemonClient({
                surfacePath,
                allowStart: false,
                ...(authToken ? { authToken } : {})
            });
            return {
                client: lease.client,
                dispose: lease.dispose
            };
        }
        throw error;
    }
}

export async function connectDedicatedAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    allowStart?: boolean;
    surfacePath?: string;
} = {}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const allowStart = input.allowStart ?? false;

    try {
        if (allowStart) {
            const daemonState = await getDaemonRuntimeState({
                surfacePath,
                allowStart,
                ...(authToken ? { authToken } : {}),
                ...(input.locals ? { locals: input.locals } : {})
            });
            if (!daemonState.running) {
                throw new DaemonUnavailableError(daemonState);
            }
        }

        return await openDaemonConnection({
            surfacePath,
            allowStart: false,
            ...(authToken ? { authToken } : {})
        });
    } catch (error) {
        if (allowStart && !isDaemonUnavailableError(error)) {
            const daemonState = await getDaemonRuntimeState({
                surfacePath,
                allowStart,
                ...(authToken ? { authToken } : {}),
                ...(input.locals ? { locals: input.locals } : {})
            });
            if (!daemonState.running) {
                throw new DaemonUnavailableError(daemonState);
            }

            return await openDaemonConnection({
                surfacePath,
                allowStart: false,
                ...(authToken ? { authToken } : {})
            });
        }
        throw error;
    }
}