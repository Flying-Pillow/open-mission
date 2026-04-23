import { command, getRequestEvent } from '$app/server';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { entityCommandInvocationSchema, executeEntityCommand } from './dispatch';

export const cmd = command(entityCommandInvocationSchema, async (input) =>
    executeEntityCommand(new AirportWebGateway(getRequestEvent().locals), input)
);
