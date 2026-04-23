import { form, getRequestEvent } from '$app/server';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { entityFormInvocationSchema, executeEntityForm } from './dispatch';

export const frm = form(entityFormInvocationSchema, async (input) =>
    executeEntityForm(new AirportWebGateway(getRequestEvent().locals), input)
);
