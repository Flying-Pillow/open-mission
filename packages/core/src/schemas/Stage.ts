import { z } from 'zod/v4';
import {
    entityCommandAcknowledgementSchema,
    entityCommandListSnapshotSchema
} from './EntityRemote.js';
import { missionArtifactSnapshotSchema } from './Artifact.js';
import { missionTaskSnapshotSchema } from './Task.js';

export const missionStageEntityName = 'Stage' as const;
export const stageEntityName = missionStageEntityName;

export const stageIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1)
}).strict();

export const stageEntityReferenceSchema = stageIdentityPayloadSchema.extend({
    entity: z.literal(missionStageEntityName)
}).strict();

export const stageExecuteCommandPayloadSchema = stageIdentityPayloadSchema.extend({
    commandId: z.string().trim().min(1),
    input: z.unknown().optional()
}).strict();

export const missionStageSnapshotSchema = z.object({
    stageId: z.string().trim().min(1),
    lifecycle: z.string().trim().min(1),
    isCurrentStage: z.boolean(),
    artifacts: z.array(missionArtifactSnapshotSchema),
    tasks: z.array(missionTaskSnapshotSchema)
}).strict();

export const stageSnapshotSchema = missionStageSnapshotSchema;

export const stageCommandListSnapshotSchema = entityCommandListSnapshotSchema.extend({
    entity: z.literal(missionStageEntityName),
    missionId: z.string().trim().min(1),
    stageId: z.string().trim().min(1)
}).strict();

export const stageCommandAcknowledgementSchema = entityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionStageEntityName),
    method: z.literal('executeCommand'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    stageId: z.string().trim().min(1),
    commandId: z.string().trim().min(1)
}).strict();

export const stageRemoteQueryPayloadSchemas = {
    read: stageIdentityPayloadSchema,
    listCommands: stageIdentityPayloadSchema
} as const;

export const stageRemoteCommandPayloadSchemas = {
    executeCommand: stageExecuteCommandPayloadSchema
} as const;

export const stageRemoteQueryResultSchemas = {
    read: missionStageSnapshotSchema,
    listCommands: stageCommandListSnapshotSchema
} as const;

export const stageRemoteCommandResultSchemas = {
    executeCommand: stageCommandAcknowledgementSchema
} as const;

export type StageIdentityPayload = z.infer<typeof stageIdentityPayloadSchema>;
export type StageEntityReference = z.infer<typeof stageEntityReferenceSchema>;
export type StageExecuteCommandPayload = z.infer<typeof stageExecuteCommandPayloadSchema>;
export type MissionStageSnapshot = z.infer<typeof missionStageSnapshotSchema>;
export type StageSnapshot = z.infer<typeof stageSnapshotSchema>;
export type StageCommandListSnapshot = z.infer<typeof stageCommandListSnapshotSchema>;
export type StageCommandAcknowledgement = z.infer<typeof stageCommandAcknowledgementSchema>;
