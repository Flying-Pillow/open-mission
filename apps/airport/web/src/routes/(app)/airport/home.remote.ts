import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';

const airportHomeDataQuerySchema = z.object({});

export const getAirportHomeData = query(
    airportHomeDataQuerySchema,
    async () => {
        const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
        const gateway = new DaemonGateway(getRequestEvent().locals);
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
            ...(githubRepositoriesError ? { githubRepositoriesError } : {}),
        };
    },
);