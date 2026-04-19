// /apps/airport/web/src/routes/+page.server.ts: Loads the Airport home route with repository management data and repository registration actions.
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { repositoryRegistrationInputSchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { clearGithubAuthSession } from '$lib/server/github-auth.server';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ locals }) => {
    const gateway = new AirportWebGateway(locals);

    return {
        loginHref: '/login?redirectTo=/',
        airportHome: await gateway.getAirportHomeSnapshot()
    };
};

export const actions: Actions = {
    addRepository: async ({ locals, request }) => {
        const formData = await request.formData();
        const parsed = repositoryRegistrationInputSchema.safeParse({
            repositoryPath: formData.get('repositoryPath')
        });

        if (!parsed.success) {
            return fail(400, {
                addRepository: {
                    error: parsed.error.issues[0]?.message ?? 'Repository path is required.',
                    repositoryPath: String(formData.get('repositoryPath') ?? '')
                }
            });
        }

        try {
            const gateway = new AirportWebGateway(locals);
            const repository = await gateway.addRepository(parsed.data.repositoryPath);
            return {
                addRepository: {
                    success: true,
                    repositoryPath: repository.repositoryRootPath
                }
            };
        } catch (error) {
            return fail(400, {
                addRepository: {
                    error: error instanceof Error ? error.message : String(error),
                    repositoryPath: parsed.data.repositoryPath
                }
            });
        }
    },
    logout: async ({ cookies, locals }) => {
        await clearGithubAuthSession(cookies);
        locals.githubAuthToken = undefined;
        throw redirect(303, '/');
    }
};