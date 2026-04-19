// /apps/airport/web/src/routes/auth/github/callback/+server.ts: Completes the GitHub OAuth callback and establishes a server-side session.
import { redirect } from '@sveltejs/kit';
import {
    clearGithubAuthSession,
    completeGithubOAuthCallback
} from '$lib/server/github-auth.server';

export const GET = async ({ cookies, url }) => {
    const code = url.searchParams.get('code')?.trim();
    const state = url.searchParams.get('state')?.trim();
    const githubError = url.searchParams.get('error')?.trim();
    const githubErrorDescription = url.searchParams.get('error_description')?.trim();

    if (githubError) {
        await clearGithubAuthSession(cookies);
        const loginUrl = new URL('/login', url);
        loginUrl.searchParams.set(
            'githubAuthError',
            githubErrorDescription || `GitHub OAuth failed: ${githubError}.`
        );
        throw redirect(303, loginUrl.toString());
    }

    if (!code || !state) {
        await clearGithubAuthSession(cookies);
        const loginUrl = new URL('/login', url);
        loginUrl.searchParams.set('githubAuthError', 'GitHub OAuth callback is missing the code or state parameter.');
        throw redirect(303, loginUrl.toString());
    }

    let result: { redirectTo: string };

    try {
        result = await completeGithubOAuthCallback({
            cookies,
            requestUrl: url,
            code,
            state
        });
    } catch (error) {
        await clearGithubAuthSession(cookies);
        const loginUrl = new URL('/login', url);
        loginUrl.searchParams.set(
            'githubAuthError',
            error instanceof Error ? error.message : String(error)
        );
        throw redirect(303, loginUrl.toString());
    }

    throw redirect(303, result.redirectTo);
};