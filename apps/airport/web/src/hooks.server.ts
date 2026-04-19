// /apps/airport/web/src/hooks.server.ts: Initializes daemon connectivity state and GitHub-backed app context for each request.
import type { Handle } from '@sveltejs/kit';
import { DaemonApi } from '@flying-pillow/mission-core';
import {
    connectAirportControl,
    readSystemStatus,
    resolveAirportControlRuntimeMode,
} from '@flying-pillow/mission-core';
import {
    clearGithubAuthSession,
    readGithubAuthToken
} from '$lib/server/github-auth.server';

type GithubStatus = 'connected' | 'disconnected' | 'unknown';

type DaemonRuntimeState = {
    running: boolean;
    startedByHook: boolean;
    message: string;
    endpointPath?: string;
    lastCheckedAt: string;
};

let daemonStartupCheck: Promise<DaemonRuntimeState> | undefined;

function resolveSurfacePath(): string {
    const configuredSurfacePath = process.env['MISSION_SURFACE_PATH']?.trim();
    if (configuredSurfacePath && configuredSurfacePath.length > 0) {
        return configuredSurfacePath;
    }

    return process.cwd();
}

async function checkOrStartDaemon(): Promise<DaemonRuntimeState> {
    const surfacePath = resolveSurfacePath();
    const runtimeMode = resolveAirportControlRuntimeMode(import.meta.url);

    try {
        const existingClient = await connectAirportControl({
            surfacePath,
            runtimeMode,
            allowStart: false,
        });

        try {
            const api = new DaemonApi(existingClient);
            const snapshot = await api.airport.getStatus();
            const endpointPath = snapshot.state.airport.substrate.sessionName;

            return {
                running: true,
                startedByHook: false,
                message: `Mission daemon connected (airport=${snapshot.state.airport.airportId}).`,
                endpointPath,
                lastCheckedAt: new Date().toISOString(),
            };
        } finally {
            existingClient.dispose();
        }
    } catch {
        try {
            const startedClient = await connectAirportControl({
                surfacePath,
                runtimeMode,
                allowStart: true,
            });

            try {
                const api = new DaemonApi(startedClient);
                const snapshot = await api.airport.getStatus();
                const endpointPath = snapshot.state.airport.substrate.sessionName;

                return {
                    running: true,
                    startedByHook: true,
                    message: `Mission daemon started and connected (airport=${snapshot.state.airport.airportId}).`,
                    endpointPath,
                    lastCheckedAt: new Date().toISOString(),
                };
            } finally {
                startedClient.dispose();
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return {
                running: false,
                startedByHook: true,
                message: `Mission daemon connection/start failed: ${reason}`,
                lastCheckedAt: new Date().toISOString(),
            };
        }
    }
}

async function ensureDaemonState(): Promise<DaemonRuntimeState> {
    daemonStartupCheck ??= checkOrStartDaemon();
    return daemonStartupCheck;
}

void ensureDaemonState().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[airport-web] Mission daemon startup check failed: ${message}`);
});

function resolveGithubStatus(systemStatus: ReturnType<typeof readSystemStatus>): GithubStatus {
    if (systemStatus.github.authenticated) {
        return 'connected';
    }
    if (systemStatus.github.cliAvailable) {
        return 'disconnected';
    }
    return 'unknown';
}

function resolveGitHubContext(authToken?: string): {
    githubStatus: GithubStatus;
    user?: App.AppContext['user'];
} {
    const systemStatus = readSystemStatus({
        cwd: resolveSurfacePath(),
        ...(authToken?.trim() ? { authToken } : {})
    });
    const githubStatus = resolveGithubStatus(systemStatus);
    const githubUser = systemStatus.github.user?.trim();
    const githubEmail = systemStatus.github.email?.trim();
    const githubAvatarUrl = systemStatus.github.avatarUrl?.trim();

    return {
        githubStatus,
        ...(githubUser
            ? {
                user: {
                    name: githubUser,
                    ...(githubEmail ? { email: githubEmail } : {}),
                    ...(githubAvatarUrl ? { avatarUrl: githubAvatarUrl } : {}),
                    githubStatus
                }
            }
            : {})
    };
}

export const handle: Handle = async ({ event, resolve }) => {
    const daemonState = await ensureDaemonState();
    const githubAuthToken = await readGithubAuthToken(event.cookies);
    const githubContext = resolveGitHubContext(githubAuthToken);
    if (githubAuthToken && githubContext.githubStatus !== 'connected') {
        await clearGithubAuthSession(event.cookies);
        event.locals.githubAuthToken = undefined;
        event.locals.appContext = {
            daemon: daemonState,
            githubStatus: 'disconnected'
        };

        return resolve(event);
    }

    event.locals.githubAuthToken = githubAuthToken;
    event.locals.appContext = {
        daemon: daemonState,
        githubStatus: githubContext.githubStatus,
        ...(githubContext.user ? { user: githubContext.user } : {})
    };

    return resolve(event);
};
