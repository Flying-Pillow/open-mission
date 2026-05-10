import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityIdSchema
} from '../Entity/EntitySchema.js';

export const taskEntityName = 'Task' as const;

export const TaskIdSchema = z.string().trim().min(1);

export const TaskCommandIds = {
    configure: 'task.configure',
    start: 'task.start',
    cancel: 'task.cancel',
    complete: 'task.complete',
    reopen: 'task.reopen',
    rework: 'task.rework',
    reworkFromVerification: 'task.reworkFromVerification',
    enableAutostart: 'task.enableAutostart',
    disableAutostart: 'task.disableAutostart'
} as const;

export const TaskCommandIdSchema = z.enum([
    TaskCommandIds.configure,
    TaskCommandIds.start,
    TaskCommandIds.cancel,
    TaskCommandIds.complete,
    TaskCommandIds.reopen,
    TaskCommandIds.rework,
    TaskCommandIds.reworkFromVerification,
    TaskCommandIds.enableAutostart,
    TaskCommandIds.disableAutostart
]);

export const TaskLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    taskId: TaskIdSchema
}).strict();

export const TaskEventSubjectSchema = TaskLocatorSchema.extend({
    entity: z.literal(taskEntityName)
}).strict();

export const TaskCommandInputSchema = TaskLocatorSchema.extend({
    commandId: TaskCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const TaskStartCommandOptionsSchema = z.object({
    agentAdapter: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    terminalName: z.string().trim().min(1).optional()
}).strict();

export const TaskReworkCommandInputSchema = z.string().trim().min(1);

export const TaskContextArtifactReferenceSchema = z.object({
    name: z.string().trim().min(1),
    path: z.string().trim().min(1),
    selectionPosition: z.number().int().nonnegative()
}).strict();

export const TaskConfigureCommandOptionsSchema = z.object({
    agentAdapter: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).nullable().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
    autostart: z.boolean().optional(),
    context: z.array(TaskContextArtifactReferenceSchema).optional()
}).strict();

export const TaskStorageSchema = z.object({
    id: EntityIdSchema,
    taskId: TaskIdSchema,
    stageId: z.string().trim().min(1),
    sequence: z.number().int().positive(),
    title: z.string().trim().min(1),
    instruction: z.string(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: z.string().trim().min(1).optional(),
    lifecycle: z.string().trim().min(1),
    dependsOn: z.array(z.string().trim().min(1)),
    context: z.array(TaskContextArtifactReferenceSchema).optional(),
    waitingOnTaskIds: z.array(z.string().trim().min(1)),
    agentAdapter: z.string().trim().min(1),
    autostart: z.boolean().optional(),
    retries: z.number().int().nonnegative(),
    fileName: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
}).strict();

export const TaskDataSchema = z.object({
    ...TaskStorageSchema.shape
}).strict();

export const TaskCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(taskEntityName),
    method: z.literal('command'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: TaskIdSchema,
    commandId: TaskCommandIdSchema
}).strict();

export const TaskDataChangedSchema = z.object({
    reference: TaskEventSubjectSchema,
    data: TaskDataSchema
}).strict();

export type TaskLocatorType = z.infer<typeof TaskLocatorSchema>;
export type TaskEventSubjectType = z.infer<typeof TaskEventSubjectSchema>;
export type TaskCommandIdType = z.infer<typeof TaskCommandIdSchema>;
export type TaskCommandInputType = z.infer<typeof TaskCommandInputSchema>;
export type TaskConfigureCommandOptionsType = z.infer<typeof TaskConfigureCommandOptionsSchema>;
export type TaskStartCommandOptionsType = z.infer<typeof TaskStartCommandOptionsSchema>;
export type TaskReworkCommandInputType = z.infer<typeof TaskReworkCommandInputSchema>;
export type TaskContextArtifactReferenceType = z.infer<typeof TaskContextArtifactReferenceSchema>;
export type TaskStorageType = z.infer<typeof TaskStorageSchema>;
export type TaskDataType = z.infer<typeof TaskDataSchema>;
export type TaskCommandAcknowledgementType = z.infer<typeof TaskCommandAcknowledgementSchema>;
export type TaskDataChangedType = z.infer<typeof TaskDataChangedSchema>;

