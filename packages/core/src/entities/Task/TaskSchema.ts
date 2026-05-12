import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntitySchema,
    EntityStorageSchema
} from '../Entity/EntitySchema.js';
import { MISSION_STAGE_IDS } from '../../workflow/stages.js';
import { MISSION_TASK_LIFECYCLE_STATES } from '../../workflow/engine/constants.js';

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

export const TaskCommandMethodSchema = z.enum([
    'configure',
    'start',
    'cancel',
    'complete',
    'reopen',
    'rework',
    'reworkFromVerification',
    'enableAutostart',
    'disableAutostart'
]);

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

export const TaskConfigureInputSchema = TaskLocatorSchema.extend(TaskConfigureCommandOptionsSchema.shape).strict();
export const TaskStartInputSchema = TaskLocatorSchema.extend(TaskStartCommandOptionsSchema.shape).strict();
export const TaskCancelInputSchema = TaskLocatorSchema.extend({
    reason: z.string().trim().min(1).optional()
}).strict();
export const TaskReworkInputSchema = TaskLocatorSchema.extend({
    input: TaskReworkCommandInputSchema
}).strict();

export const TaskDossierRecordSchema = z.object({
    taskId: TaskIdSchema,
    stage: z.enum(MISSION_STAGE_IDS),
    sequence: z.number().int().positive(),
    subject: z.string().trim().min(1),
    instruction: z.string(),
    body: z.string(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: z.string().trim().min(1).optional(),
    dependsOn: z.array(TaskIdSchema),
    context: z.array(TaskContextArtifactReferenceSchema).optional(),
    waitingOn: z.array(TaskIdSchema),
    status: z.enum(MISSION_TASK_LIFECYCLE_STATES),
    agent: z.string().trim().min(1),
    autostart: z.boolean().optional(),
    retries: z.number().int().nonnegative(),
    fileName: z.string().trim().min(1),
    filePath: z.string().trim().min(1),
    relativePath: z.string().trim().min(1)
}).strict();

export const TaskDossierRecordUpdateSchema = TaskDossierRecordSchema.pick({
    status: true,
    agent: true,
    retries: true
}).partial().strict();

export const TaskStorageSchema = EntityStorageSchema.extend({
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

export const TaskDataSchema = TaskStorageSchema.extend({}).strict();

const TaskStoragePayloadSchema = TaskStorageSchema.omit({ id: true });

export const TaskSchema = EntitySchema.extend({
    ...TaskStoragePayloadSchema.shape
}).strict();

export const TaskCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(taskEntityName),
    method: TaskCommandMethodSchema.or(z.literal('command')),
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
export type TaskCommandMethodType = z.infer<typeof TaskCommandMethodSchema>;
export type TaskCommandInputType = z.infer<typeof TaskCommandInputSchema>;
export type TaskConfigureCommandOptionsType = z.infer<typeof TaskConfigureCommandOptionsSchema>;
export type TaskStartCommandOptionsType = z.infer<typeof TaskStartCommandOptionsSchema>;
export type TaskConfigureInputType = z.infer<typeof TaskConfigureInputSchema>;
export type TaskStartInputType = z.infer<typeof TaskStartInputSchema>;
export type TaskCancelInputType = z.infer<typeof TaskCancelInputSchema>;
export type TaskReworkInputType = z.infer<typeof TaskReworkInputSchema>;
export type TaskReworkCommandInputType = z.infer<typeof TaskReworkCommandInputSchema>;
export type TaskContextArtifactReferenceType = z.infer<typeof TaskContextArtifactReferenceSchema>;
export type TaskDossierRecordType = z.infer<typeof TaskDossierRecordSchema>;
export type TaskDossierRecordUpdateType = z.infer<typeof TaskDossierRecordUpdateSchema>;
export type TaskStorageType = z.infer<typeof TaskStorageSchema>;
export type TaskDataType = z.infer<typeof TaskDataSchema>;
export type TaskType = z.infer<typeof TaskSchema>;
export type TaskCommandAcknowledgementType = z.infer<typeof TaskCommandAcknowledgementSchema>;
export type TaskDataChangedType = z.infer<typeof TaskDataChangedSchema>;

