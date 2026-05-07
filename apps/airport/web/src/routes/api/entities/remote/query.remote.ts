import { getRequestEvent, query } from '$app/server';
import { error as kitError } from '@sveltejs/kit';
import * as entityProxy from '$lib/server/daemon/entity-proxy';
import { entityQueryInvocationSchema, executeEntityQuery } from './dispatch';

export const qry = query(entityQueryInvocationSchema, async (input) => {
    try {
        return await executeEntityQuery(new entityProxy.EntityProxy(getRequestEvent().locals), input);
    } catch (error) {
        kitError(400, error instanceof Error ? error.message : String(error));
    }
});
