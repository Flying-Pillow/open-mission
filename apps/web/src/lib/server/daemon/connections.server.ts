// /apps/web/src/lib/server/daemon/connections.server.ts: Public daemon connection entrypoints for Open Mission web gateway code.
import type { DaemonClient } from '@flying-pillow/open-mission-core/daemon/client/DaemonClient';
import { resolveRequestAuthToken, resolveSurfacePath } from './context.server';
import { acquireSharedDaemonClient, clearSharedDaemonClient } from './shared-client.server';
import { openDaemonConnection } from './transport.server';

export async function connectSharedAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    surfacePath?: string;
} = {}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();

    const lease = await acquireSharedDaemonClient({
        surfacePath,
        ...(authToken ? { authToken } : {})
    });

    return {
        client: lease.client,
        dispose: lease.dispose
    };
}

export function resetSharedAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    surfacePath?: string;
} = {}): void {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    clearSharedDaemonClient(surfacePath, authToken);
}

export function isRecoverableDaemonConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const code = (error as Error & { code?: string }).code;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ENOENT') {
        return true;
    }

    return error.message === 'Daemon client is not connected.'
        || error.message === 'Daemon client was disposed.'
        || error.message === 'Open Mission daemon connection closed.'
        || error.message.includes('connect ENOENT')
        || error.message.includes('connect ECONNREFUSED')
        || error.message.includes('socket closed')
        || error.message.includes('connection closed');
}

export async function connectDedicatedAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    surfacePath?: string;
} = {}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();

    return await openDaemonConnection({
        surfacePath,
        ...(authToken ? { authToken } : {})
    });
}