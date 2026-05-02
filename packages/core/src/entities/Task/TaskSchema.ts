import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';

export const taskEntityName = 'Task' as const;

export const TaskIdSchema = z.string().trim().min(1);

export const TaskCommandIds = {
    start: 'task.start',
    complete: 'task.complete',
    reopen: 'task.reopen',
    rework: 'task.rework',
    reworkFromVerification: 'task.reworkFromVerification',
    enableAutostart: 'task.enableAutostart',
    disableAutostart: 'task.disableAutostart'
} as const;

export const TaskCommandIdSchema = z.enum([
    TaskCommandIds.start,
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

export const TaskExecuteCommandInputSchema = TaskLocatorSchema.extend({
    commandId: TaskCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const TaskStorageSchema = z.object({
    taskId: TaskIdSchema,
    stageId: z.string().trim().min(1),
    sequence: z.number().int().positive(),
    title: z.string().trim().min(1),
    instruction: z.string(),
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: z.string().trim().min(1).optional(),
    lifecycle: z.string().trim().min(1),
    dependsOn: z.array(z.string().trim().min(1)),
    waitingOnTaskIds: z.array(z.string().trim().min(1)),
    agentRunner: z.string().trim().min(1),
    retries: z.number().int().nonnegative(),
    fileName: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
}).strict();

export const TaskDataSchema = z.object({
    ...TaskStorageSchema.shape,
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export const TaskCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(taskEntityName),
    method: z.literal('executeCommand'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: TaskIdSchema,
    commandId: TaskCommandIdSchema
}).strict();

export const TaskSnapshotChangedEventSchema = z.object({
    reference: TaskEventSubjectSchema,
    snapshot: TaskDataSchema
}).strict();

export const taskRemoteQueryInputSchemas = {
    read: TaskLocatorSchema
} as const;

export const taskRemoteCommandInputSchemas = {
    executeCommand: TaskExecuteCommandInputSchema
} as const;

export const taskRemoteQueryResultSchemas = {
    read: TaskDataSchema
} as const;

export const taskRemoteCommandResultSchemas = {
    executeCommand: TaskCommandAcknowledgementSchema
} as const;

export type TaskLocatorType = z.infer<typeof TaskLocatorSchema>;
export type TaskEventSubjectType = z.infer<typeof TaskEventSubjectSchema>;
export type TaskCommandIdType = z.infer<typeof TaskCommandIdSchema>;
export type TaskExecuteCommandInputType = z.infer<typeof TaskExecuteCommandInputSchema>;
export type TaskStorageType = z.infer<typeof TaskStorageSchema>;
export type TaskDataType = z.infer<typeof TaskDataSchema>;
export type TaskCommandAcknowledgementType = z.infer<typeof TaskCommandAcknowledgementSchema>;
export type TaskSnapshotChangedEventType = z.infer<typeof TaskSnapshotChangedEventSchema>;

