import { z } from 'zod/v4';
import { EntityIdSchema, EntityMethodNameSchema, EntityNameSchema } from './EntitySchema.js';

export const entityQueryInvocationSchema = z.object({
    entity: EntityNameSchema,
    method: EntityMethodNameSchema,
    id: EntityIdSchema.optional(),
    payload: z.unknown().optional()
}).strict();

export const entityCommandInvocationSchema = z.object({
    entity: EntityNameSchema,
    method: EntityMethodNameSchema,
    id: EntityIdSchema.optional(),
    payload: z.unknown().optional()
}).strict();

export const entityFormInvocationSchema = entityCommandInvocationSchema;

export type EntityQueryInvocation = z.infer<typeof entityQueryInvocationSchema>;
export type EntityCommandInvocation = z.infer<typeof entityCommandInvocationSchema>;
export type EntityFormInvocation = z.infer<typeof entityFormInvocationSchema>;
export type EntityRemoteResult = unknown;