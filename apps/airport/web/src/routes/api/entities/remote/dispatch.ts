import type { EntityCommandInvocation, EntityFormInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';
import { entityCommandInvocationSchema, entityFormInvocationSchema, entityQueryInvocationSchema } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';

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
