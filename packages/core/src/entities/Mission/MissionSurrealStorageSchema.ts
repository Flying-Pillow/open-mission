import { z } from 'zod/v4';
import { field as surrealField, table as surrealTable } from '@flying-pillow/zod-surreal';
import { EntityStorageSchema } from '../Entity/EntitySchema.js';
import { ArtifactDataSchema } from '../Artifact/ArtifactSchema.js';
import { MissionAssigneeSchema, MissionTypeSchema } from './MissionSchema.js';
import { TaskContextArtifactReferenceSchema } from '../Task/TaskSchema.js';

export const MissionSurrealStorageSchema = EntityStorageSchema.extend({
    title: z.string().trim().min(1).register(surrealField, { type: 'string', searchable: true }),
    issueId: z.number().int().positive().optional().register(surrealField, { type: 'int', optional: true, index: 'normal' }),
    assignee: MissionAssigneeSchema.optional().register(surrealField, { type: 'object', optional: true }),
    type: MissionTypeSchema.register(surrealField, { type: 'string', index: 'normal' }),
    operationalMode: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true }),
    branchRef: z.string().trim().min(1).register(surrealField, { type: 'string', index: 'unique' }),
    missionDir: z.string().trim().min(1).register(surrealField, { type: 'string' }),
    missionRootDir: z.string().trim().min(1).register(surrealField, { type: 'string' }),
    lifecycle: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true, index: 'normal' }),
    updatedAt: z.string().trim().min(1).optional().register(surrealField, { type: 'datetime', optional: true }),
    currentStageId: z.string().trim().min(1).optional().register(surrealField, { reference: 'Stage', optional: true, index: 'normal' }),
    recommendedAction: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true })
}).strict().register(surrealTable, {
    table: 'mission',
    schemafull: true,
    comment: 'Mission physical storage record. SurrealDB record id is the Mission identity.'
});

export const StageSurrealStorageSchema = EntityStorageSchema.extend({
    missionId: z.string().trim().min(1).register(surrealField, { reference: 'Mission', onDelete: 'cascade', index: 'normal' }),
    lifecycle: z.string().trim().min(1).register(surrealField, { type: 'string', index: 'normal' }),
    isCurrentStage: z.boolean().register(surrealField, { type: 'bool', index: 'normal' }),
    artifacts: z.array(ArtifactDataSchema).register(surrealField, { type: 'object', array: true })
}).strict().register(surrealTable, {
    table: 'stage',
    schemafull: true,
    comment: 'Mission stage physical storage record. SurrealDB record id is the Stage identity.'
});

export const TaskSurrealStorageSchema = EntityStorageSchema.extend({
    missionId: z.string().trim().min(1).register(surrealField, { reference: 'Mission', onDelete: 'cascade', index: 'normal' }),
    stageId: z.string().trim().min(1).register(surrealField, { reference: 'Stage', onDelete: 'cascade', index: 'normal' }),
    sequence: z.number().int().positive().register(surrealField, { type: 'int', index: 'normal' }),
    title: z.string().trim().min(1).register(surrealField, { type: 'string', searchable: true }),
    instruction: z.string().register(surrealField, { type: 'string', searchable: true }),
    model: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true }),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional().register(surrealField, { type: 'string', optional: true }),
    taskKind: z.enum(['implementation', 'verification']).optional().register(surrealField, { type: 'string', optional: true, index: 'normal' }),
    pairedTaskId: z.string().trim().min(1).optional().register(surrealField, { reference: 'Task', optional: true }),
    lifecycle: z.string().trim().min(1).register(surrealField, { type: 'string', index: 'normal' }),
    dependsOn: z.array(z.string().trim().min(1)).register(surrealField, { reference: 'Task', array: true }),
    context: z.array(TaskContextArtifactReferenceSchema).optional().register(surrealField, { type: 'object', array: true, optional: true }),
    waitingOnTaskIds: z.array(z.string().trim().min(1)).register(surrealField, { reference: 'Task', array: true }),
    agentAdapter: z.string().trim().min(1).register(surrealField, { type: 'string', index: 'normal' }),
    autostart: z.boolean().optional().register(surrealField, { type: 'bool', optional: true }),
    retries: z.number().int().nonnegative().register(surrealField, { type: 'int' }),
    fileName: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true }),
    filePath: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true }),
    relativePath: z.string().trim().min(1).optional().register(surrealField, { type: 'string', optional: true })
}).strict().register(surrealTable, {
    table: 'task',
    schemafull: true,
    comment: 'Mission task physical storage record. SurrealDB record id is the Task identity.'
});