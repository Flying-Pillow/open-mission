import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';
import { ArtifactDataSchema } from '../Artifact/ArtifactSchema.js';
import { TaskDataSchema } from '../Task/TaskSchema.js';

export const stageEntityName = 'Stage' as const;

export const StageIdSchema = z.string().trim().min(1);

export const StageCommandIds = {
    generateTasks: 'stage.generateTasks'
} as const;

export const StageCommandIdSchema = z.enum([
    StageCommandIds.generateTasks
]);

export const StageLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    stageId: StageIdSchema
}).strict();

export const StageEventSubjectSchema = StageLocatorSchema.extend({
    entity: z.literal(stageEntityName)
}).strict();

export const StageExecuteCommandInputSchema = StageLocatorSchema.extend({
    commandId: StageCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const StageStorageSchema = z.object({
    stageId: StageIdSchema,
    lifecycle: z.string().trim().min(1),
    isCurrentStage: z.boolean(),
    artifacts: z.array(ArtifactDataSchema),
    tasks: z.array(TaskDataSchema)
}).strict();

export const StageDataSchema = z.object({
    ...StageStorageSchema.shape,
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export const StageCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(stageEntityName),
    method: z.literal('executeCommand'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    stageId: StageIdSchema,
    commandId: StageCommandIdSchema
}).strict();

export const stageRemoteQueryInputSchemas = {
    read: StageLocatorSchema
} as const;

export const stageRemoteCommandInputSchemas = {
    executeCommand: StageExecuteCommandInputSchema
} as const;

export const stageRemoteQueryResultSchemas = {
    read: StageDataSchema
} as const;

export const stageRemoteCommandResultSchemas = {
    executeCommand: StageCommandAcknowledgementSchema
} as const;

export type StageLocatorType = z.infer<typeof StageLocatorSchema>;
export type StageEventSubjectType = z.infer<typeof StageEventSubjectSchema>;
export type StageCommandIdType = z.infer<typeof StageCommandIdSchema>;
export type StageExecuteCommandInputType = z.infer<typeof StageExecuteCommandInputSchema>;
export type StageStorageType = z.infer<typeof StageStorageSchema>;
export type StageDataType = z.infer<typeof StageDataSchema>;
export type StageCommandAcknowledgementType = z.infer<typeof StageCommandAcknowledgementSchema>;

