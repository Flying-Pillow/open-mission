import { getRequestEvent, query } from '$app/server';
import { entityQueryInvocationSchema, executeEntityQuery } from './dispatch';
export const qry = query(entityQueryInvocationSchema, async (input) => {
	const { EntityProxy } = await import('$lib/server/daemon/entity-proxy');
    return executeEntityQuery(new EntityProxy(getRequestEvent().locals), input);
});
