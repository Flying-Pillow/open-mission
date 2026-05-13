import { isDaemonUnavailableError } from './daemon/health.server';

const STALE_DAEMON_ERROR_PATTERNS = [
    "Cannot read properties of undefined (reading 'workspaceRoute')",
    "Cannot read properties of undefined (reading 'includeSurfacePath')"
];

export type MissionTerminalRuntimeError = {
    message: string;
    status: number;
};

const DAEMON_UNAVAILABLE_MESSAGE_PREFIX = 'Open Mission daemon is unavailable';

export function isStaleMissionTerminalDaemonError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return STALE_DAEMON_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function resolveMissionTerminalRuntimeError(error: unknown): MissionTerminalRuntimeError {
    const message = error instanceof Error ? error.message : String(error);

    if (isStaleMissionTerminalDaemonError(error)) {
        return {
            message: 'Open Mission daemon is running an older protocol version. Restart the Open Mission daemon or dev server and try again.',
            status: 503
        };
    }

    if (isDaemonUnavailableError(error) || message.includes(DAEMON_UNAVAILABLE_MESSAGE_PREFIX)) {
        return {
            message,
            status: 503
        };
    }

    if (message.includes('Open Mission daemon connection timed out')) {
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