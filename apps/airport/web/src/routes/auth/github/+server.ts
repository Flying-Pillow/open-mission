// /apps/airport/web/src/routes/auth/github/+server.ts: Starts the GitHub OAuth redirect flow for Airport web.
import { redirect } from '@sveltejs/kit';
import {
    createGithubOAuthAuthorization,
    getGitHubOAuthConfigurationError,
    normalizeRedirectTarget
} from '$lib/server/github-auth.server';

export const GET = async ({ cookies, url }) => {
    const configurationError = getGitHubOAuthConfigurationError();
    if (configurationError) {
        const loginUrl = new URL('/login', url);
        loginUrl.searchParams.set('githubAuthError', configurationError);
        throw redirect(303, loginUrl.toString());
    }

    const redirectTo = normalizeRedirectTarget(url.searchParams.get('redirectTo'));
    const authorizationUrl = await createGithubOAuthAuthorization({
        cookies,
        requestUrl: url,
        redirectTo
    });

    throw redirect(303, authorizationUrl.toString());
};