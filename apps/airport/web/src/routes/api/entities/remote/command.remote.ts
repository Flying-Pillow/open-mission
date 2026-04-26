import { command, getRequestEvent } from '$app/server';
import { entityCommandInvocationSchema, executeEntityCommand } from './dispatch';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

export const cmd = command(entityCommandInvocationSchema, async (input) => {
    return executeEntityCommand(new EntityProxy(getRequestEvent().locals), input);
});
