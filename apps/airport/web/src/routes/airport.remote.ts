// /apps/airport/web/src/routes/airport.remote.ts: Transitional app-level glue over the generic entity query boundary.
import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { repositorySchema } from '@flying-pillow/mission-core/airport/runtime';
import { listAirportRepositoriesThroughEntityBoundary } from './api/entities/remote/dispatch';

const airportRepositoriesQuerySchema = z.object({});

export const getAirportRepositories = query(
    airportRepositoriesQuerySchema,
    async () => {
        return z.array(repositorySchema).parse(
            await listAirportRepositoriesThroughEntityBoundary(
                new AirportWebGateway(getRequestEvent().locals)
            )
        );
    },
);
