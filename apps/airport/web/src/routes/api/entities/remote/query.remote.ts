import { getRequestEvent, query } from '$app/server';
import { error as kitError } from '@sveltejs/kit';
import { entityQueryInvocationSchema, executeEntityQuery } from './dispatch';

export const qry = query(entityQueryInvocationSchema, async (input) => {
	const { EntityProxy } = await import('$lib/server/daemon/entity-proxy');
	try {
		return await executeEntityQuery(new EntityProxy(getRequestEvent().locals), input);
	} catch (error) {
		kitError(400, error instanceof Error ? error.message : String(error));
	}
});
