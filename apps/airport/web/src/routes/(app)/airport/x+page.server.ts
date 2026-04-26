// /apps/airport/web/src/routes/(app)/airport/+page.server.ts: Minimal Airport route load that only returns daemon and GitHub shell state.
import { redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { clearGithubAuthSession } from '$lib/server/github-auth.server';

export const prerender = false;

export const load: PageServerLoad = async ({ locals }) => {
    return {
        appContext: locals.appContext,
        loginHref: '/login?redirectTo=/airport',
    };
};

export const actions: Actions = {
    logout: async ({ cookies, locals }) => {
        await clearGithubAuthSession(cookies);
        locals.githubAuthToken = undefined;
        throw redirect(303, '/');
    }
};