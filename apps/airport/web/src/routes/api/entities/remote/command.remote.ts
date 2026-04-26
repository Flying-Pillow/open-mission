import { command, getRequestEvent } from '$app/server';
import { entityCommandInvocationSchema, executeEntityCommand } from './dispatch';

export const cmd = command(entityCommandInvocationSchema, async (input) => {
	const { EntityProxy } = await import('$lib/server/daemon/entity-proxy');
    return executeEntityCommand(new EntityProxy(getRequestEvent().locals), input);
});
