// /apps/airport/web/src/lib/server/daemon/health.server.ts: Reads daemon availability for Airport UI without daemon process control.
import type { SystemState } from '@flying-pillow/mission-core/entities/System/SystemSchema';
import { resolveRequestAuthToken, resolveSurfacePath } from './context.server';
import { clearSharedDaemonClient } from './shared-client.server';
import { openDaemonConnection } from './transport.server';

const DAEMON_HEALTH_CACHE_TTL_MS = 3_000;
const DAEMON_HEALTH_CHECK_STALE_MS = 5_000;

export type DaemonRuntimeState = {
    running: boolean;
    message: string;
    endpointPath?: string;
    lastCheckedAt: string;
};

type DaemonHealthRecord = {
    state: DaemonRuntimeState;
    checkedAtMs: number;
};

let daemonHealthRecord: DaemonHealthRecord | undefined;
let daemonHealthCheck: Promise<DaemonRuntimeState> | undefined;
let daemonHealthCheckStartedAtMs = 0;

export class DaemonUnavailableError extends Error {
    public readonly runtimeState: DaemonRuntimeState;

    public constructor(runtimeState: DaemonRuntimeState) {
        super(runtimeState.message);
        this.name = 'DaemonUnavailableError';
        this.runtimeState = runtimeState;
    }
}

export function isDaemonUnavailableError(error: unknown): error is DaemonUnavailableError {
    return error instanceof DaemonUnavailableError;
}

export async function readCachedDaemonSystemStatus(input: {
    locals?: App.Locals;
    authToken?: string;
    surfacePath?: string;
    timeoutMs?: number;
} = {}): Promise<SystemState | undefined> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const timeoutMs = input.timeoutMs ?? 1_000;

    try {
        const daemon = await openDaemonConnection({
            surfacePath,
            ...(authToken ? { authToken } : {})
        });
        try {
            return await daemon.client.request<SystemState>('system.status', undefined, { timeoutMs });
        } finally {
            daemon.dispose();
        }
    } catch {
        return undefined;
    }
}

export async function getDaemonRuntimeState(input: {
    locals?: App.Locals;
    authToken?: string;
    surfacePath?: string;
    timeoutMs?: number;
} = {}): Promise<DaemonRuntimeState> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const now = Date.now();
    const timeoutMs = input.timeoutMs ?? 0;

    if (
        daemonHealthRecord?.state.running
        && now - daemonHealthRecord.checkedAtMs < DAEMON_HEALTH_CACHE_TTL_MS
    ) {
        return daemonHealthRecord.state;
    }

    if (daemonHealthCheck && now - daemonHealthCheckStartedAtMs <= DAEMON_HEALTH_CHECK_STALE_MS) {
        return timeoutMs > 0
            ? await raceDaemonRuntimeState(daemonHealthCheck, timeoutMs, now)
            : daemonHealthCheck;
    }
    if (daemonHealthCheck) {
        daemonHealthCheck = undefined;
        daemonHealthCheckStartedAtMs = 0;
    }

    const healthCheck = checkDaemonRuntimeState({
        surfacePath,
        ...(authToken ? { authToken } : {})
    }).finally(() => {
        if (daemonHealthCheck === healthCheck) {
            daemonHealthCheck = undefined;
            daemonHealthCheckStartedAtMs = 0;
        }
    });
    daemonHealthCheck = healthCheck;
    daemonHealthCheckStartedAtMs = now;

    return timeoutMs > 0
        ? await raceDaemonRuntimeState(healthCheck, timeoutMs, now)
        : healthCheck;
}

async function raceDaemonRuntimeState(
    runtimeStatePromise: Promise<DaemonRuntimeState>,
    timeoutMs: number,
    checkedAtMs: number
): Promise<DaemonRuntimeState> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            runtimeStatePromise,
            new Promise<DaemonRuntimeState>((resolve) => {
                timer = setTimeout(() => {
                    resolve(buildPendingDaemonState(checkedAtMs));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async function checkDaemonRuntimeState(input: {
    surfacePath: string;
    authToken?: string;
}): Promise<DaemonRuntimeState> {
    const now = Date.now();
    const authToken = input.authToken?.trim();

    try {
        const daemon = await openDaemonConnection({
            surfacePath: input.surfacePath,
            ...(authToken ? { authToken } : {})
        });
        try {
            return rememberDaemonRuntimeState({
                state: {
                    running: true,
                    message: 'Mission daemon connected.',
                    lastCheckedAt: new Date(now).toISOString()
                },
                checkedAtMs: now
            });
        } finally {
            daemon.dispose();
        }
    } catch (error) {
        clearSharedDaemonClient(input.surfacePath, authToken);
        return rememberDaemonRuntimeState({
            state: buildUnavailableDaemonState({
                error,
                checkedAtMs: now
            }),
            checkedAtMs: now
        });
    }
}

function rememberDaemonRuntimeState(input: {
    state: DaemonRuntimeState;
    checkedAtMs: number;
}): DaemonRuntimeState {
    daemonHealthRecord = {
        state: input.state,
        checkedAtMs: input.checkedAtMs
    };

    return input.state;
}

function buildUnavailableDaemonState(input: {
    error: unknown;
    checkedAtMs: number;
}): DaemonRuntimeState {
    const reason = input.error instanceof Error ? input.error.message : String(input.error);
    return {
        running: false,
        message: `Mission daemon is unavailable: ${reason}`,
        lastCheckedAt: new Date(input.checkedAtMs).toISOString()
    };
}

function buildPendingDaemonState(checkedAtMs: number): DaemonRuntimeState {
    const lastKnownState = daemonHealthRecord?.state;
    if (lastKnownState?.running) {
        return {
            ...lastKnownState,
            lastCheckedAt: new Date(checkedAtMs).toISOString()
        };
    }

    return {
        running: false,
        message: lastKnownState?.message ?? 'Mission daemon availability check is still in progress.',
        lastCheckedAt: new Date(checkedAtMs).toISOString()
    };
}
