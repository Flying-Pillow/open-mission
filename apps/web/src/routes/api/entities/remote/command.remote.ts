import { command, getRequestEvent } from '$app/server';
import { error as kitError } from '@sveltejs/kit';
import * as entityProxy from '$lib/server/daemon/entity-proxy';
import { entityCommandInvocationSchema, executeEntityCommand } from './dispatch';

export const cmd = command(entityCommandInvocationSchema, async (input) => {
    try {
        return await executeEntityCommand(new entityProxy.EntityProxy(getRequestEvent().locals), input);
    } catch (error) {
        kitError(400, error instanceof Error ? error.message : String(error));
    }
});
