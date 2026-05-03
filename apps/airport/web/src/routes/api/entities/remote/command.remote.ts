import { command, getRequestEvent } from '$app/server';
import { error as kitError } from '@sveltejs/kit';
import { entityCommandInvocationSchema, executeEntityCommand } from './dispatch';

export const cmd = command(entityCommandInvocationSchema, async (input) => {
    const { EntityProxy } = await import('$lib/server/daemon/entity-proxy');
    try {
        return await executeEntityCommand(new EntityProxy(getRequestEvent().locals), input);
    } catch (error) {
        kitError(400, error instanceof Error ? error.message : String(error));
    }
});
