import { readSystemStatus } from '@flying-pillow/mission-core';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import {
    clearGithubAuthSession,
    getGitHubDeviceConfigurationError,
    hasGitHubDeviceConfiguration,
    getGitHubOAuthConfigurationError,
    hasGitHubOAuthConfiguration,
    normalizeRedirectTarget
} from '$lib/server/github-auth.server';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ locals, url }) => {
    const redirectTo = normalizeRedirectTarget(url.searchParams.get('redirectTo'));
    const oauthError = url.searchParams.get('githubAuthError')?.trim();
    const oauthConfigurationError = getGitHubOAuthConfigurationError();
    const deviceConfigurationError = getGitHubDeviceConfigurationError();

    if (!locals.githubAuthToken) {
        return {
            redirectTo,
            oauth: {
                available: hasGitHubOAuthConfiguration(),
                error: oauthError || oauthConfigurationError,
                startHref: `/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`
            },
            device: {
                available: hasGitHubDeviceConfiguration(),
                error: deviceConfigurationError,
                startHref: `/auth/github/device?redirectTo=${encodeURIComponent(redirectTo)}`,
                pollHref: '/auth/github/device/poll'
            },
            githubProbe: {
                status: 'idle' as const,
                message: oauthConfigurationError && deviceConfigurationError
                    ? 'GitHub OAuth is not configured for Airport web yet.'
                    : 'Sign in with the configured GitHub App to unlock daemon-backed repository workflows.'
            }
        };
    }

    return {
        redirectTo,
        oauth: {
            available: hasGitHubOAuthConfiguration(),
            error: oauthError,
            startHref: `/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`
        },
        device: {
            available: hasGitHubDeviceConfiguration(),
            error: deviceConfigurationError,
            startHref: `/auth/github/device?redirectTo=${encodeURIComponent(redirectTo)}`,
            pollHref: '/auth/github/device/poll'
        },
        githubProbe: {
            status: 'success' as const,
            message: 'GitHub is connected. Mission will attach the server-side OAuth session to authenticated requests.'
        }
    };
};

export const actions: Actions = {
    clearGithubToken: async ({ cookies, locals, request, url }) => {
        const formData = await request.formData();
        const redirectTo = normalizeRedirectTarget(String(formData.get('redirect_to') ?? '') || url.searchParams.get('redirectTo'));

        await clearGithubAuthSession(cookies);
        locals.githubAuthToken = undefined;
        throw redirect(303, redirectTo === '/login' ? '/login' : redirectTo);
    }
};