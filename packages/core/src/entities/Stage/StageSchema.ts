import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntitySchema,
    EntityStorageSchema
} from '../Entity/EntitySchema.js';
import { ArtifactDataSchema } from '../Artifact/ArtifactSchema.js';
import { TaskDataSchema, TaskDossierRecordSchema, TaskSchema } from '../Task/TaskSchema.js';
import { MISSION_STAGE_DERIVED_STATES } from '../../workflow/engine/constants.js';
import { MISSION_STAGE_IDS } from '../../workflow/stages.js';

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

export const StageCommandInputSchema = StageLocatorSchema.extend({
    commandId: StageCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const StageCommandMethodSchema = z.enum(['generateTasks']);
export const StageInstanceInputSchema = z.object({}).strict();

export const StageStorageSchema = EntityStorageSchema.extend({
    missionId: z.string().trim().min(1).register(field, {
        reference: 'Mission',
        onDelete: 'cascade',
        index: 'normal',
        description: 'Owning Mission reference stored in the physical Stage record.'
    }),
    stageId: StageIdSchema,
    lifecycle: z.string().trim().min(1).register(field, {
        index: 'normal',
        description: 'Stage lifecycle state stored in the physical Stage record.'
    }),
    isCurrentStage: z.boolean().register(field, {
        index: 'normal',
        description: 'Whether this Stage is the current Mission stage in the physical Stage record.'
    }),
    artifacts: z.array(ArtifactDataSchema).register(field, {
        description: 'Stage artifact data stored in the physical Stage record.'
    })
}).strict().register(table, {
    table: 'stage',
    schemafull: true,
    description: 'Mission stage physical storage record. SurrealDB record id is the Stage identity.'
});

export const StageDataSchema = StageStorageSchema.extend({
    tasks: z.array(TaskDataSchema)
}).strict();

const StageDataPayloadSchema = StageDataSchema.omit({ id: true });

export const StageSchema = EntitySchema.extend({
    ...StageDataPayloadSchema.shape,
    tasks: z.array(TaskSchema)
}).strict();

export const StageStatusViewSchema = z.object({
    stage: z.enum(MISSION_STAGE_IDS),
    folderName: z.string().trim().min(1),
    status: z.enum(MISSION_STAGE_DERIVED_STATES),
    taskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    activeTaskIds: z.array(z.string().trim().min(1)),
    readyTaskIds: z.array(z.string().trim().min(1)),
    tasks: z.array(TaskDossierRecordSchema)
}).strict();

export const StageCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(stageEntityName),
    method: StageCommandMethodSchema.or(z.literal('command')),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    stageId: StageIdSchema,
    commandId: StageCommandIdSchema
}).strict();

export const StageDataChangedSchema = z.object({
    reference: StageEventSubjectSchema,
    data: StageDataSchema
}).strict();

export type StageLocatorType = z.infer<typeof StageLocatorSchema>;
export type StageEventSubjectType = z.infer<typeof StageEventSubjectSchema>;
export type StageCommandIdType = z.infer<typeof StageCommandIdSchema>;
export type StageCommandMethodType = z.infer<typeof StageCommandMethodSchema>;
export type StageCommandInputType = z.infer<typeof StageCommandInputSchema>;
export type StageInstanceInputType = z.infer<typeof StageInstanceInputSchema>;
export type StageStorageType = z.infer<typeof StageStorageSchema>;
export type StageDataType = z.infer<typeof StageDataSchema>;
export type StageType = z.infer<typeof StageSchema>;
export type StageStatusViewType = z.infer<typeof StageStatusViewSchema>;
export type StageCommandAcknowledgementType = z.infer<typeof StageCommandAcknowledgementSchema>;
export type StageDataChangedType = z.infer<typeof StageDataChangedSchema>;

