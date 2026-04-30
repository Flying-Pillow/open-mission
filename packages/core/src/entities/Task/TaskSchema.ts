import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';

export const missionTaskEntityName = 'Task' as const;
export const taskEntityName = missionTaskEntityName;

export const taskIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1)
}).strict();

export const taskEntityReferenceSchema = taskIdentityPayloadSchema.extend({
    entity: z.literal(missionTaskEntityName)
}).strict();

export const taskExecuteCommandPayloadSchema = taskIdentityPayloadSchema.extend({
    commandId: z.string().trim().min(1),
    input: z.unknown().optional()
}).strict();

export const missionTaskSnapshotSchema = z.object({
    taskId: z.string().trim().min(1),
    stageId: z.string().trim().min(1),
    sequence: z.number().int().positive(),
    title: z.string().trim().min(1),
    instruction: z.string(),
    lifecycle: z.string().trim().min(1),
    dependsOn: z.array(z.string().trim().min(1)),
    waitingOnTaskIds: z.array(z.string().trim().min(1)),
    agentRunner: z.string().trim().min(1),
    retries: z.number().int().nonnegative(),
    fileName: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional(),
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export const taskSnapshotSchema = missionTaskSnapshotSchema;

export const taskCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionTaskEntityName),
    method: z.literal('executeCommand'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    commandId: z.string().trim().min(1)
}).strict();

export const taskRemoteQueryPayloadSchemas = {
    read: taskIdentityPayloadSchema
} as const;

export const taskRemoteCommandPayloadSchemas = {
    executeCommand: taskExecuteCommandPayloadSchema
} as const;

export const taskRemoteQueryResultSchemas = {
    read: missionTaskSnapshotSchema
} as const;

export const taskRemoteCommandResultSchemas = {
    executeCommand: taskCommandAcknowledgementSchema
} as const;

export type TaskIdentityPayload = z.infer<typeof taskIdentityPayloadSchema>;
export type TaskEntityReference = z.infer<typeof taskEntityReferenceSchema>;
export type TaskExecuteCommandPayload = z.infer<typeof taskExecuteCommandPayloadSchema>;
export type MissionTaskSnapshot = z.infer<typeof missionTaskSnapshotSchema>;
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type TaskCommandAcknowledgement = z.infer<typeof taskCommandAcknowledgementSchema>;

