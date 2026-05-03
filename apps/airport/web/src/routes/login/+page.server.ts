import { redirect, type Actions } from '@sveltejs/kit';
import {
    clearGithubAuthSession,
    getGitHubDeviceConfigurationError,
    hasGitHubDeviceConfiguration,
    normalizeRedirectTarget
} from '$lib/server/github-auth.server';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ locals, url }) => {
    const redirectTo = normalizeRedirectTarget(url.searchParams.get('redirectTo'));
    const authError = url.searchParams.get('githubAuthError')?.trim();
    const deviceConfigurationError = getGitHubDeviceConfigurationError();
    const deviceAvailable = hasGitHubDeviceConfiguration();
    const githubStatus = locals.appContext.githubStatus;
    const appContext = {
        githubStatus: locals.appContext.githubStatus,
        user: locals.appContext.user,
    };

    if (githubStatus !== 'connected') {
        return {
            appContext,
            redirectTo,
            error: authError,
            device: {
                available: deviceAvailable,
                error: deviceConfigurationError,
                startHref: `/auth/github/device?redirectTo=${encodeURIComponent(redirectTo)}`,
                pollHref: '/auth/github/device/poll'
            },
            githubProbe: {
                status: 'idle' as const,
                message: !deviceAvailable
                    ? 'GitHub sign-in is not ready yet.'
                    : 'Sign in with GitHub to continue.'
            }
        };
    }

    return {
        appContext,
        redirectTo,
        error: authError,
        device: {
            available: deviceAvailable,
            error: deviceConfigurationError,
            startHref: `/auth/github/device?redirectTo=${encodeURIComponent(redirectTo)}`,
            pollHref: '/auth/github/device/poll'
        },
        githubProbe: {
            status: 'success' as const,
            message: 'You are signed in and ready to continue.'
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