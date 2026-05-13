// /apps/web/src/hooks.server.ts: Initializes daemon connectivity state and GitHub-backed app context for each request.
import { redirect, type Handle } from '@sveltejs/kit';
import type { AppContextServerValue } from '$lib/client/context/app-context.svelte';
import {
    readGithubAuthToken,
    readGithubSessionContext
} from '$lib/server/github-auth.server';
import { shouldRedirectUnavailableDaemonRoute } from '$lib/server/daemon/route-access';
import {
    getDaemonRuntimeState,
    type DaemonRuntimeState,
} from '$lib/server/daemon/health.server';
import { resolveSurfacePath } from '$lib/server/daemon/context.server';
import { startOpenMissionDaemonBootstrap } from '$lib/server/daemon/bootstrap.server';

type GithubStatus = 'connected' | 'disconnected' | 'unknown';

const DAEMON_STATE_REQUEST_TIMEOUT_MS = 1_500;

startOpenMissionDaemonBootstrap();

function resolveCanonicalOrigin(requestUrl: URL): string | undefined {
    const configuredCallbackUrl = process.env['GITHUB_OAUTH_CALLBACK_URL']?.trim();
    if (configuredCallbackUrl) {
        return new URL(configuredCallbackUrl).origin;
    }

    if (process.env['NODE_ENV'] !== 'production' && requestUrl.port === '5174') {
        return `${requestUrl.protocol}//127.0.0.1:${requestUrl.port}`;
    }

    return undefined;
}

async function ensureDaemonState(): Promise<DaemonRuntimeState> {
    return getDaemonRuntimeState({
        surfacePath: resolveSurfacePath(),
        timeoutMs: DAEMON_STATE_REQUEST_TIMEOUT_MS,
    });
}

function createUncheckedDaemonState(): DaemonRuntimeState {
    return {
        running: false,
        message: 'Open Mission daemon state was not checked for this request.',
        lastCheckedAt: new Date(0).toISOString()
    };
}

function resolveGithubStatus(authenticated: boolean): GithubStatus {
    if (authenticated) {
        return 'connected';
    }
    return 'disconnected';
}

function resolveGitHubContext(input: {
    authenticated: boolean;
    user?: {
        name: string;
        email?: string;
        avatarUrl?: string;
    };
}): {
    githubStatus: GithubStatus;
    user?: AppContextServerValue['user'];
} {
    const githubStatus = resolveGithubStatus(input.authenticated);
    const githubUser = input.user?.name?.trim();
    const githubEmail = input.user?.email?.trim();
    const githubAvatarUrl = input.user?.avatarUrl?.trim();

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
    const canonicalOrigin = resolveCanonicalOrigin(event.url);
    const isApiRequest = event.url.pathname.startsWith('/api/');
    const isAuthRequest = event.url.pathname.startsWith('/auth/');
    const isRemoteFunctionRequest = event.isRemoteRequest || event.url.pathname.startsWith('/_app/remote/');
    if (
        canonicalOrigin
        && event.url.origin !== canonicalOrigin
        && ['GET', 'HEAD'].includes(event.request.method)
        && !isApiRequest
        && !isRemoteFunctionRequest
    ) {
        throw redirect(307, `${canonicalOrigin}${event.url.pathname}${event.url.search}`);
    }

    const daemonState = isApiRequest || isAuthRequest || isRemoteFunctionRequest
        ? createUncheckedDaemonState()
        : await ensureDaemonState();
    const githubAuthToken = await readGithubAuthToken(event.cookies);
    const githubSession = await readGithubSessionContext(event.cookies);
    const githubContext = resolveGitHubContext(githubSession);

    event.locals.githubAuthToken = githubAuthToken;
    event.locals.appContext = {
        daemon: daemonState,
        githubStatus: githubContext.githubStatus,
        ...(githubContext.user ? { user: githubContext.user } : {})
    };

    const pathname = event.url.pathname;
    if (shouldRedirectUnavailableDaemonRoute({
        pathname,
        daemonRunning: daemonState.running
    }) && !isRemoteFunctionRequest) {
        throw redirect(303, '/');
    }

    return resolve(event);
};
