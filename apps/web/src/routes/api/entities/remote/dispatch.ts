import type { EntityCommandInvocation, EntityFormInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/open-mission-core/entities/Entity/EntityInvocation';
import { entityCommandInvocationSchema, entityFormInvocationSchema, entityQueryInvocationSchema } from '@flying-pillow/open-mission-core/entities/Entity/EntityInvocation';

export {
    entityCommandInvocationSchema,
    entityFormInvocationSchema,
    entityQueryInvocationSchema
};

export type EntityRemoteGateway = {
    executeEntityQuery(input: EntityQueryInvocation): Promise<EntityRemoteResult>;
    executeEntityCommand(input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult>;
};

export async function executeEntityQuery(
    gateway: EntityRemoteGateway,
    input: EntityQueryInvocation
): Promise<EntityRemoteResult> {
    return await gateway.executeEntityQuery(entityQueryInvocationSchema.parse(input));
}

export async function executeEntityCommand(
    gateway: EntityRemoteGateway,
    input: EntityCommandInvocation
): Promise<EntityRemoteResult> {
    return await gateway.executeEntityCommand(entityCommandInvocationSchema.parse(input));
}

export async function executeEntityForm(
    gateway: EntityRemoteGateway,
    input: EntityFormInvocation
): Promise<EntityRemoteResult> {
    return await gateway.executeEntityCommand(entityFormInvocationSchema.parse(input));
}
