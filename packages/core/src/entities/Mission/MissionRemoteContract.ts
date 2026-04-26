import { z } from 'zod/v4';
import {
	missionRuntimeMissionCommandSchema,
	missionRuntimeSessionCommandSchema,
	missionRuntimeTaskCommandSchema
} from '../../schemas/MissionRuntime.js';

export const missionEntityName = 'Mission' as const;

export const missionIdentityPayloadSchema = z.object({
	missionId: z.string().trim().min(1),
	repositoryRootPath: z.string().trim().min(1).optional()
});

const operatorActionExecutionStepSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('selection'),
		stepId: z.string().trim().min(1),
		optionIds: z.array(z.string().trim().min(1))
	}),
	z.object({
		kind: z.literal('text'),
		stepId: z.string().trim().min(1),
		value: z.string()
	})
]);

export const missionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
	command: missionRuntimeMissionCommandSchema
});

export const missionTaskCommandPayloadSchema = missionIdentityPayloadSchema.extend({
	taskId: z.string().trim().min(1),
	command: missionRuntimeTaskCommandSchema
});

export const missionSessionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
	sessionId: z.string().trim().min(1),
	command: missionRuntimeSessionCommandSchema
});

export const missionExecuteActionPayloadSchema = missionIdentityPayloadSchema.extend({
	actionId: z.string().trim().min(1),
	steps: z.array(operatorActionExecutionStepSchema).optional(),
	terminalSessionName: z.string().trim().min(1).optional()
});

export const missionRemoteQueryPayloadSchemas = {
	read: missionIdentityPayloadSchema
} as const;

export const missionRemoteCommandPayloadSchemas = {
	command: missionCommandPayloadSchema,
	taskCommand: missionTaskCommandPayloadSchema,
	sessionCommand: missionSessionCommandPayloadSchema,
	executeAction: missionExecuteActionPayloadSchema
} as const;

export type MissionIdentityPayload = z.infer<typeof missionIdentityPayloadSchema>;
export type MissionCommandPayload = z.infer<typeof missionCommandPayloadSchema>;
export type MissionTaskCommandPayload = z.infer<typeof missionTaskCommandPayloadSchema>;
export type MissionSessionCommandPayload = z.infer<typeof missionSessionCommandPayloadSchema>;
export type MissionExecuteActionPayload = z.infer<typeof missionExecuteActionPayloadSchema>;