import { getRequestEvent, query } from '$app/server';
import { entityQueryInvocationSchema, executeEntityQuery } from './dispatch';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';
export const qry = query(entityQueryInvocationSchema, async (input) => {
    return executeEntityQuery(new EntityProxy(getRequestEvent().locals), input);
});
