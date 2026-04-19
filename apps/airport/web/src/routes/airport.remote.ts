// /apps/airport/web/src/routes/airport.remote.ts: App-level remote queries for Airport shell state such as registered repositories.
import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import { repositoryCandidateDtoSchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';

const airportRepositoriesQuerySchema = z.object({});

export const getAirportRepositories = query(
    airportRepositoriesQuerySchema,
    async () => {
        const { locals } = getRequestEvent();
        const gateway = new AirportWebGateway(locals);
        const snapshot = await gateway.getAirportHomeSnapshot();

        return z.array(repositoryCandidateDtoSchema).parse(snapshot.repositories);
    },
);