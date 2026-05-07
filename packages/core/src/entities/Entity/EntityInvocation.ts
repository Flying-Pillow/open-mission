import { z } from 'zod/v4';
import { EntityMethodNameSchema, EntityNameSchema } from './EntitySchema.js';

export const entityQueryInvocationSchema = z.object({
    entity: EntityNameSchema,
    method: EntityMethodNameSchema,
    payload: z.unknown().optional()
}).strict();

export const entityCommandInvocationSchema = z.object({
    entity: EntityNameSchema,
    method: EntityMethodNameSchema,
    payload: z.unknown().optional()
}).strict();

export const entityFormInvocationSchema = entityCommandInvocationSchema;

export type EntityQueryInvocation = z.infer<typeof entityQueryInvocationSchema>;
export type EntityCommandInvocation = z.infer<typeof entityCommandInvocationSchema>;
export type EntityFormInvocation = z.infer<typeof entityFormInvocationSchema>;