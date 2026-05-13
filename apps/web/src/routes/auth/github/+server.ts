// /apps/web/src/routes/auth/github/+server.ts: Browser OAuth is disabled; Open Mission web uses device flow only.
import { redirect } from '@sveltejs/kit';

export const GET = async ({ url }) => {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('githubAuthError', 'Browser OAuth is disabled. Use GitHub device sign-in instead.');
    throw redirect(303, loginUrl.toString());
};