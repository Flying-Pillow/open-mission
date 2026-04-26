import { form, getRequestEvent } from '$app/server';
import { entityFormInvocationSchema, executeEntityForm } from './dispatch';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

export const frm = form(entityFormInvocationSchema, async (input) => {
    return executeEntityForm(new EntityProxy(getRequestEvent().locals), input);
});
