import { getRequestEvent, query } from '$app/server';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { entityQueryInvocationSchema, executeEntityQuery } from './dispatch';

export const qry = query(entityQueryInvocationSchema, async (input) =>
    executeEntityQuery(new AirportWebGateway(getRequestEvent().locals), input)
);
