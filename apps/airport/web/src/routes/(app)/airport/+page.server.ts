// /apps/airport/web/src/routes/+page.server.ts: Loads the Airport home route with repository management data and repository registration actions.
import path from 'node:path';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { clearGithubAuthSession } from '$lib/server/github-auth.server';
import type { PageServerLoad } from './$types';

const repositoryRegistrationInputSchema = z.object({
    repositoryPath: z.string().trim().min(1, 'Repository path is required.'),
    githubRepository: z.string().trim().min(1).optional()
});

export const prerender = false;

export const load: PageServerLoad = async ({ locals }) => {
    const gateway = new AirportWebGateway(locals);
    let githubRepositories: Array<{
        fullName: string;
        ownerLogin?: string;
        htmlUrl?: string;
        visibility: 'private' | 'public';
        archived: boolean;
    }> = [];
    let githubRepositoriesError: string | undefined;

    try {
        githubRepositories = await gateway.listVisibleGitHubRepositories();
    } catch (error) {
        githubRepositoriesError = error instanceof Error ? error.message : String(error);
    }

    return {
        loginHref: '/login?redirectTo=/airport',
        airportHome: await gateway.getAirportHomeSnapshot(),
        githubRepositories,
        ...(githubRepositoriesError ? { githubRepositoriesError } : {})
    };
};

export const actions: Actions = {
    addRepository: async ({ locals, request }) => {
        const formData = await request.formData();
        const parsed = repositoryRegistrationInputSchema.safeParse({
            repositoryPath: formData.get('repositoryPath'),
            githubRepository: formData.get('githubRepository')
        });

        if (!parsed.success) {
            return fail(400, {
                addRepository: {
                    error: parsed.error.issues[0]?.message ?? 'Repository path is required.',
                    repositoryPath: String(formData.get('repositoryPath') ?? ''),
                    githubRepository: String(formData.get('githubRepository') ?? '')
                }
            });
        }

        const repositoryPath = parsed.data.repositoryPath;
        if (!path.isAbsolute(repositoryPath)) {
            return fail(400, {
                addRepository: {
                    error: 'Repository path must be an absolute local checkout path on the daemon host.',
                    repositoryPath,
                    ...(parsed.data.githubRepository ? { githubRepository: parsed.data.githubRepository } : {})
                }
            });
        }

        try {
            const gateway = new AirportWebGateway(locals);
            const selectedGitHubRepository = parsed.data.githubRepository?.trim();
            const repository = selectedGitHubRepository
                ? await gateway.cloneGitHubRepository(selectedGitHubRepository, repositoryPath)
                : await gateway.inspectRepositoryPath(repositoryPath).then((inspectedRepository) => gateway.addRepository(inspectedRepository.repositoryRootPath));
            return {
                addRepository: {
                    success: true,
                    repositoryPath: repository.repositoryRootPath,
                    ...(selectedGitHubRepository ? { githubRepository: selectedGitHubRepository } : {})
                }
            };
        } catch (error) {
            return fail(400, {
                addRepository: {
                    error: error instanceof Error ? error.message : String(error),
                    repositoryPath: parsed.data.repositoryPath,
                    ...(parsed.data.githubRepository ? { githubRepository: parsed.data.githubRepository } : {})
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