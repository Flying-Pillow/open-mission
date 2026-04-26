import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import { githubVisibleRepositorySchema } from '@flying-pillow/mission-core/schemas';
import { executeEntityQuery } from '../../api/entities/remote/dispatch';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

const airportHomeDataQuerySchema = z.object({});

export const getAirportHomeData = query(
    airportHomeDataQuerySchema,
    async () => {
        const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
        const event = getRequestEvent();
        const gateway = new DaemonGateway(event.locals);
        const entityProxy = new EntityProxy(event.locals);
        let githubRepositories: Array<{
            fullName: string;
            ownerLogin?: string;
            htmlUrl?: string;
            visibility: 'private' | 'public';
            archived: boolean;
        }> = [];
        let githubRepositoriesError: string | undefined;

        try {
            githubRepositories = z.array(githubVisibleRepositorySchema).parse(
                await executeEntityQuery(entityProxy, {
                    entity: 'GitHubRepository',
                    method: 'find',
                    payload: {}
                })
            );
        } catch (error) {
            githubRepositoriesError = error instanceof Error ? error.message : String(error);
        }

        return {
            appContext: event.locals.appContext,
            loginHref: '/login?redirectTo=/airport',
            airportHome: await gateway.getAirportHomeSnapshot(),
            githubRepositories,
            ...(githubRepositoriesError ? { githubRepositoriesError } : {}),
        };
    },
);