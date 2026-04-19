// /apps/airport/web/src/lib/server/daemon.server.ts: Resolves authenticated Mission daemon connections for SvelteKit server routes.
import {
    connectAirportControl,
    type DaemonClient,
    resolveAirportControlRuntimeMode
} from '@flying-pillow/mission-core';

const AIRPORT_WEB_PERF_TRACE_ENV = 'MISSION_AIRPORT_WEB_TRACE_PERF';

export function isAirportWebPerfTracingEnabled(): boolean {
    const rawValue = process.env[AIRPORT_WEB_PERF_TRACE_ENV]?.trim().toLowerCase();
    return rawValue === '1' || rawValue === 'true' || rawValue === 'yes' || rawValue === 'on';
}

export function logAirportWebPerf(
    label: string,
    startedAt: number,
    details: Record<string, string | number | boolean | null | undefined> = {}
): void {
    if (!isAirportWebPerfTracingEnabled()) {
        return;
    }

    const suffix = Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');

    console.info(
        `[airport-web:perf] ${label} durationMs=${(performance.now() - startedAt).toFixed(1)}${suffix ? ` ${suffix}` : ''}`
    );
}

export function resolveRequestAuthToken(locals?: App.Locals): string | undefined {
    const authToken = locals?.githubAuthToken?.trim();
    return authToken && authToken.length > 0 ? authToken : undefined;
}

export function resolveSurfacePath(): string {
    const configuredSurfacePath = process.env['MISSION_SURFACE_PATH']?.trim();
    if (configuredSurfacePath && configuredSurfacePath.length > 0) {
        return configuredSurfacePath;
    }

    return process.cwd();
}

export async function connectAuthenticatedDaemonClient(input: {
    locals?: App.Locals;
    authToken?: string;
    allowStart?: boolean;
    surfacePath?: string;
} = {}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const startedAt = performance.now();
    const authToken = input.authToken?.trim() || resolveRequestAuthToken(input.locals);
    const surfacePath = input.surfacePath?.trim() || resolveSurfacePath();
    const allowStart = input.allowStart ?? false;
    let outcome = 'ok';

    try {
        const client = await connectAirportControl({
            surfacePath,
            runtimeMode: resolveAirportControlRuntimeMode(import.meta.url),
            allowStart,
            ...(authToken ? { authToken } : {})
        });

        return {
            client,
            dispose: () => client.dispose()
        };
    } catch (error) {
        outcome = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        logAirportWebPerf('daemon.connect', startedAt, {
            surfacePath,
            allowStart,
            hasAuthToken: Boolean(authToken),
            outcome
        });
    }
}