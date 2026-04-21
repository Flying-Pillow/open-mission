import { stopMissionDaemonProcess } from '@flying-pillow/mission-core/node';
import { resolveRequestAuthToken, resolveSurfacePath } from './daemon/context.server';
import { clearSharedDaemonClient } from './daemon/shared-client.server';
import { openDaemonConnection } from './daemon/transport.server';

const STALE_DAEMON_ERROR_PATTERNS = [
    "Cannot read properties of undefined (reading 'workspaceRoute')",
    "Cannot read properties of undefined (reading 'includeSurfacePath')"
];

export type MissionTerminalRuntimeError = {
    message: string;
    status: number;
};

export function isStaleMissionTerminalDaemonError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return STALE_DAEMON_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export async function restartMissionTerminalDaemon(input: {
    locals?: App.Locals;
    surfacePath?: string;
    authToken?: string;
} = {}): Promise<void> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();

    clearSharedDaemonClient(surfacePath, authToken);
    await stopMissionDaemonProcess();

    const daemon = await openDaemonConnection({
        surfacePath,
        allowStart: true,
        ...(authToken ? { authToken } : {})
    });
    daemon.dispose();
    clearSharedDaemonClient(surfacePath, authToken);
}

export function resolveMissionTerminalRuntimeError(error: unknown): MissionTerminalRuntimeError {
    const message = error instanceof Error ? error.message : String(error);

    if (isStaleMissionTerminalDaemonError(error)) {
        return {
            message: 'Mission daemon is running an older protocol version. Restart the mission daemon or dev server and try again.',
            status: 503
        };
    }

    if (message.includes('Mission daemon connection timed out')) {
        return {
            message,
            status: 504
        };
    }

    return {
        message,
        status: 500
    };
}