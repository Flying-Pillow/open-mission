import { z } from 'zod/v4';

export const entityNameSchema = z.string().trim().min(1);
export const entityMethodSchema = z.string().trim().min(1);

export const entityQueryInvocationSchema = z.object({
	entity: entityNameSchema,
	method: entityMethodSchema,
	payload: z.unknown().optional()
});

export const entityCommandInvocationSchema = z.object({
	entity: entityNameSchema,
	method: entityMethodSchema,
	payload: z.unknown().optional()
});

export const entityFormInvocationSchema = entityCommandInvocationSchema;

export const entityMutationStatusSchema = z.object({
	missionId: z.string().trim().min(1).optional()
});

export type EntityQueryInvocation = z.infer<typeof entityQueryInvocationSchema>;
export type EntityCommandInvocation = z.infer<typeof entityCommandInvocationSchema>;
export type EntityFormInvocation = z.infer<typeof entityFormInvocationSchema>;
export type EntityMutationStatus = z.infer<typeof entityMutationStatusSchema>;
export type EntityRemoteResult = unknown;