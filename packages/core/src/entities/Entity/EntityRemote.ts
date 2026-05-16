import type { EntityContractType } from './EntitySchema.js';
import { Entity, type EntityExecutionContext } from './Entity.js';
export {
    entityCommandInvocationSchema,
    entityFormInvocationSchema,
    entityQueryInvocationSchema,
    type EntityCommandInvocation,
    type EntityFormInvocation,
    type EntityQueryInvocation,
    type EntityRemoteResult
} from './EntityInvocation.js';
import type {
    EntityCommandInvocation,
    EntityFormInvocation,
    EntityQueryInvocation,
    EntityRemoteResult
} from './EntityInvocation.js';

export type EntityContractResolver = (entity: string) => EntityContractType | Promise<EntityContractType>;

export type EntityRemoteInvocationOptions = {
    resolveContract: EntityContractResolver;
    prepareContext?(input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation, context: EntityExecutionContext): EntityExecutionContext;
    afterCommand?(input: EntityCommandInvocation | EntityFormInvocation, context: EntityExecutionContext, result: EntityRemoteResult): Promise<void> | void;
};

export async function executeEntityQuery(
    input: EntityQueryInvocation,
    context: EntityExecutionContext,
    options: EntityRemoteInvocationOptions
): Promise<EntityRemoteResult> {
    assertEntityExecutionContext(context);
    const scopedContext = options.prepareContext?.(input, context) ?? context;
    return Entity.executeQuery(await options.resolveContract(input.entity), input, scopedContext);
}

export async function executeEntityCommand(
    input: EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext,
    options: EntityRemoteInvocationOptions
): Promise<EntityRemoteResult> {
    assertEntityExecutionContext(context);
    const scopedContext = options.prepareContext?.(input, context) ?? context;
    const result = await Entity.executeCommand(await options.resolveContract(input.entity), input, scopedContext);
    await options.afterCommand?.(input, scopedContext, result);
    return result;
}

function assertEntityExecutionContext(context: { surfacePath: string }): void {
    if (!context.surfacePath.trim()) {
        throw new Error('Entity remote invocation requires a surfacePath context.');
    }
}