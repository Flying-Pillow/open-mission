// /apps/airport/web/src/lib/server/daemon/health.server.ts: Tracks daemon availability and recovery state for the Airport web server.
import type { SystemStatus } from '@flying-pillow/mission-core';
import { resolveRequestAuthToken, resolveSurfacePath } from './context.server';
import { clearSharedDaemonClient } from './shared-client.server';
import { openDaemonConnection } from './transport.server';

const DAEMON_HEALTH_CACHE_TTL_MS = 3_000;
const DAEMON_RECOVERY_BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000, 60_000] as const;

export type DaemonRuntimeState = {
    running: boolean;
    startedByHook: boolean;
    message: string;
    endpointPath?: string;
    lastCheckedAt: string;
    nextRetryAt?: string;
    failureCount?: number;
};

type DaemonRecoveryRecord = {
    state: DaemonRuntimeState;
    checkedAtMs: number;
    consecutiveFailures: number;
    nextRetryAtMs: number;
};

let daemonRecoveryRecord: DaemonRecoveryRecord | undefined;
let daemonRecoveryCheck: Promise<DaemonRuntimeState> | undefined;

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
} = {}): Promise<SystemStatus | undefined> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const timeoutMs = input.timeoutMs ?? 1_000;

    try {
        const daemon = await openDaemonConnection({
            surfacePath,
            allowStart: false,
            ...(authToken ? { authToken } : {})
        });
        try {
            return await daemon.client.request<SystemStatus>('system.status', undefined, { timeoutMs });
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
    allowStart?: boolean;
    surfacePath?: string;
    timeoutMs?: number;
} = {}): Promise<DaemonRuntimeState> {
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const allowStart = input.allowStart ?? true;
    const now = Date.now();
    const timeoutMs = input.timeoutMs ?? 0;

    if (daemonRecoveryRecord && now - daemonRecoveryRecord.checkedAtMs < DAEMON_HEALTH_CACHE_TTL_MS) {
        return daemonRecoveryRecord.state;
    }

    if (daemonRecoveryCheck) {
        return timeoutMs > 0
            ? await raceDaemonRuntimeState(daemonRecoveryCheck, timeoutMs, now)
            : daemonRecoveryCheck;
    }

    daemonRecoveryCheck = checkDaemonRuntimeState({
        surfacePath,
        allowStart,
        ...(authToken ? { authToken } : {})
    }).finally(() => {
        daemonRecoveryCheck = undefined;
    });

    return timeoutMs > 0
        ? await raceDaemonRuntimeState(daemonRecoveryCheck, timeoutMs, now)
        : daemonRecoveryCheck;
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

function rememberDaemonRuntimeState(input: {
    state: DaemonRuntimeState;
    checkedAtMs: number;
    consecutiveFailures: number;
    nextRetryAtMs: number;
}): DaemonRuntimeState {
    daemonRecoveryRecord = {
        state: input.state,
        checkedAtMs: input.checkedAtMs,
        consecutiveFailures: input.consecutiveFailures,
        nextRetryAtMs: input.nextRetryAtMs
    };

    return input.state;
}

async function checkDaemonRuntimeState(input: {
    surfacePath: string;
    allowStart: boolean;
    authToken?: string;
}): Promise<DaemonRuntimeState> {
    const now = Date.now();
    const authToken = input.authToken?.trim();

    try {
        const daemon = await openDaemonConnection({
            surfacePath: input.surfacePath,
            allowStart: false,
            ...(authToken ? { authToken } : {})
        });
        try {
            return rememberDaemonRuntimeState({
                state: {
                    running: true,
                    startedByHook: false,
                    message: 'Mission daemon connected.',
                    lastCheckedAt: new Date(now).toISOString(),
                    failureCount: 0
                },
                checkedAtMs: now,
                consecutiveFailures: 0,
                nextRetryAtMs: 0
            });
        } finally {
            daemon.dispose();
        }
    } catch (probeError) {
        clearSharedDaemonClient(input.surfacePath, authToken);

        const previousFailures = daemonRecoveryRecord?.consecutiveFailures ?? 0;
        const nextRetryAtMs = daemonRecoveryRecord?.nextRetryAtMs ?? 0;

        if (!input.allowStart || now < nextRetryAtMs) {
            const state = buildUnavailableDaemonState({
                error: probeError,
                checkedAtMs: now,
                startedByHook: false,
                consecutiveFailures: previousFailures,
                nextRetryAtMs
            });
            return rememberDaemonRuntimeState({
                state,
                checkedAtMs: now,
                consecutiveFailures: previousFailures,
                nextRetryAtMs
            });
        }

        try {
            const daemon = await openDaemonConnection({
                surfacePath: input.surfacePath,
                allowStart: true,
                ...(authToken ? { authToken } : {})
            });
            try {
                return rememberDaemonRuntimeState({
                    state: {
                        running: true,
                        startedByHook: true,
                        message: 'Mission daemon recovered and connected.',
                        lastCheckedAt: new Date(now).toISOString(),
                        failureCount: 0
                    },
                    checkedAtMs: now,
                    consecutiveFailures: 0,
                    nextRetryAtMs: 0
                });
            } finally {
                daemon.dispose();
            }
        } catch (recoveryError) {
            clearSharedDaemonClient(input.surfacePath, authToken);
            const consecutiveFailures = previousFailures + 1;
            const recoveryBackoffMs = DAEMON_RECOVERY_BACKOFF_MS[
                Math.min(consecutiveFailures - 1, DAEMON_RECOVERY_BACKOFF_MS.length - 1)
            ];
            const scheduledRetryAtMs = now + recoveryBackoffMs;
            const state = buildUnavailableDaemonState({
                error: recoveryError,
                checkedAtMs: now,
                startedByHook: true,
                consecutiveFailures,
                nextRetryAtMs: scheduledRetryAtMs
            });
            return rememberDaemonRuntimeState({
                state,
                checkedAtMs: now,
                consecutiveFailures,
                nextRetryAtMs: scheduledRetryAtMs
            });
        }
    }
}

function buildUnavailableDaemonState(input: {
    error: unknown;
    checkedAtMs: number;
    startedByHook: boolean;
    consecutiveFailures: number;
    nextRetryAtMs: number;
}): DaemonRuntimeState {
    const reason = input.error instanceof Error ? input.error.message : String(input.error);
    const nextRetryAt = input.nextRetryAtMs > input.checkedAtMs
        ? new Date(input.nextRetryAtMs).toISOString()
        : undefined;

    return {
        running: false,
        startedByHook: input.startedByHook,
        message: nextRetryAt
            ? `Mission daemon is unavailable: ${reason}. The web app will retry recovery after ${nextRetryAt}.`
            : `Mission daemon is unavailable: ${reason}`,
        lastCheckedAt: new Date(input.checkedAtMs).toISOString(),
        ...(nextRetryAt ? { nextRetryAt } : {}),
        ...(input.consecutiveFailures > 0 ? { failureCount: input.consecutiveFailures } : {})
    };
}

function buildPendingDaemonState(checkedAtMs: number): DaemonRuntimeState {
    const lastKnownState = daemonRecoveryRecord?.state;
    const lastKnownFailureCount = daemonRecoveryRecord?.consecutiveFailures
        ?? lastKnownState?.failureCount
        ?? 0;

    return {
        running: false,
        startedByHook: true,
        message: lastKnownState?.message
            ?? 'Mission daemon recovery is still in progress. The web app will keep retrying automatically.',
        lastCheckedAt: new Date(checkedAtMs).toISOString(),
        ...(lastKnownState?.nextRetryAt ? { nextRetryAt: lastKnownState.nextRetryAt } : {}),
        ...(lastKnownFailureCount > 0 ? { failureCount: lastKnownFailureCount } : {})
    };
}