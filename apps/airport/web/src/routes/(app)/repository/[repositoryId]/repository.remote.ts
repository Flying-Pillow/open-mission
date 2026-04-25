import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { repositoryRuntimeRouteParamsSchema } from '@flying-pillow/mission-core';

const repositoryDataQuerySchema = z.object({
    repositoryId: z.string().trim().min(1)
});

export const getRepositoryData = query(
    repositoryDataQuerySchema,
    async (input) => {
        const event = getRequestEvent();
        const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
            repositoryId: input.repositoryId
        });
        const gateway = new AirportWebGateway(event.locals);
        const airportHome = await gateway.getAirportHomeSnapshot();

        return {
            airportRepositories: airportHome.repositories,
            repositorySurface: await gateway.getRepositorySurfaceSnapshot({
                repositoryId
            }),
            repositoryId
        };
    }
);