import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';
import {
    agentSessionEntityReferenceSchema,
    agentSessionCommandSchema as agentSessionControlCommandSchema,
    agentSessionTerminalHandleSchema,
    agentSessionPromptSchema,
    agentSessionSnapshotSchema
} from '../AgentSession/AgentSessionSchema.js';
import {
    artifactEntityReferenceSchema,
    missionArtifactSnapshotSchema
} from '../Artifact/ArtifactSchema.js';
import {
    missionStageSnapshotSchema,
    stageEntityReferenceSchema
} from '../Stage/StageSchema.js';
import {
    missionTaskSnapshotSchema,
    taskEntityReferenceSchema
} from '../Task/TaskSchema.js';
import {
    MissionStateDataSchema,
    MissionWorkflowEventRecordSchema
} from '../../workflow/engine/types.js';
export const missionEntityName = 'Mission' as const;

export const missionStateDataSchema = MissionStateDataSchema;

export const missionEventRecordSchema = MissionWorkflowEventRecordSchema;

export const missionEntityTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);

export const missionTaskCommandSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('start'),
        terminalSessionName: z.string().trim().min(1).optional()
    }).strict(),
    z.object({ action: z.literal('complete') }).strict(),
    z.object({ action: z.literal('reopen') }).strict()
]);

export const missionMissionCommandSchema = z.object({
    action: z.enum(['pause', 'resume', 'panic', 'clearPanic', 'restartQueue', 'deliver'])
}).strict();

export const agentSessionCommandSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('complete')
    }).strict(),
    z.object({
        action: z.literal('cancel'),
        reason: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        action: z.literal('terminate'),
        reason: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        action: z.literal('prompt'),
        prompt: agentSessionPromptSchema
    }).strict(),
    z.object({
        action: z.literal('command'),
        command: agentSessionControlCommandSchema
    }).strict()
]);

export const missionIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const missionTerminalInputSchema = z.object({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Mission terminal input requires data or a complete cols/rows resize payload.'
});

export const missionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: agentSessionTerminalHandleSchema.optional()
}).strict();

export const missionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('input'),
        data: z.string(),
        literal: z.boolean().optional()
    }).strict(),
    z.object({
        type: z.literal('resize'),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    }).strict()
]);

export const missionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: agentSessionTerminalHandleSchema.optional()
}).strict();

export const missionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: missionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type MissionTerminalInput = z.infer<typeof missionTerminalInputSchema>;
export type MissionTerminalSnapshot = z.infer<typeof missionTerminalSnapshotSchema>;
export type MissionTerminalSocketClientMessage = z.infer<typeof missionTerminalSocketClientMessageSchema>;
export type MissionTerminalOutput = z.infer<typeof missionTerminalOutputSchema>;
export type MissionTerminalSocketServerMessage = z.infer<typeof missionTerminalSocketServerMessageSchema>;

export const missionEntityReferenceSchema = missionIdentityPayloadSchema.extend({
    entity: z.literal(missionEntityName)
}).strict();

export const missionChildEntityReferenceSchema = z.discriminatedUnion('entity', [
    missionEntityReferenceSchema,
    stageEntityReferenceSchema,
    taskEntityReferenceSchema,
    artifactEntityReferenceSchema,
    agentSessionEntityReferenceSchema
]);

export const operatorActionExecutionStepSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('selection'),
        stepId: z.string().trim().min(1),
        optionIds: z.array(z.string().trim().min(1))
    }).strict(),
    z.object({
        kind: z.literal('text'),
        stepId: z.string().trim().min(1),
        value: z.string()
    }).strict()
]);

export const missionActionQueryContextSchema = z.object({
    repositoryId: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional()
}).strict();

export const missionActionDescriptorSchema = z.object({
    actionId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().optional(),
    kind: z.string().trim().min(1).optional(),
    target: z.record(z.string(), z.unknown()).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().trim().min(1).optional()
}).strict();

export const missionActionListSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    actions: z.array(missionActionDescriptorSchema),
    context: missionActionQueryContextSchema.optional()
}).strict();

export const missionDocumentSnapshotSchema = z.object({
    filePath: z.string().trim().min(1),
    content: z.string(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const missionWorkflowSnapshotSchema = z.object({
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    stages: z.array(missionStageSnapshotSchema).optional()
}).strict();

export const missionStatusSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional(),
    type: missionEntityTypeSchema.optional(),
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    missionDir: z.string().trim().min(1).optional(),
    missionRootDir: z.string().trim().min(1).optional(),
    artifacts: z.array(missionArtifactSnapshotSchema).optional(),
    workflow: missionWorkflowSnapshotSchema.optional(),
    recommendedAction: z.string().trim().min(1).optional()
}).strict();

export const missionStorageSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    issueId: z.number().int().positive().optional(),
    type: missionEntityTypeSchema,
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1),
    missionDir: z.string().trim().min(1),
    missionRootDir: z.string().trim().min(1),
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    artifacts: z.array(missionArtifactSnapshotSchema),
    stages: z.array(missionStageSnapshotSchema),
    agentSessions: z.array(agentSessionSnapshotSchema),
    recommendedAction: z.string().trim().min(1).optional()
}).strict();

export const missionDataSchema = missionStorageSchema;

export const missionDescriptorSchema = missionDataSchema.extend({
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export type MissionWorktreeNodeData = {
    name: string;
    relativePath: string;
    absolutePath: string;
    kind: 'file' | 'directory';
    children?: MissionWorktreeNodeData[] | undefined;
};

export const missionWorktreeNodeSchema: z.ZodType<MissionWorktreeNodeData> = z.object({
    name: z.string().trim().min(1),
    relativePath: z.string(),
    absolutePath: z.string().trim().min(1),
    kind: z.enum(['file', 'directory']),
    children: z.array(z.lazy(() => missionWorktreeNodeSchema)).optional()
}).strict();

export const missionWorktreeSnapshotSchema = z.object({
    rootPath: z.string().trim().min(1),
    fetchedAt: z.string().trim().min(1),
    tree: z.array(missionWorktreeNodeSchema)
}).strict();

export const missionSnapshotSchema = z.object({
    mission: missionDescriptorSchema,
    status: missionStatusSnapshotSchema.optional(),
    workflow: missionWorkflowSnapshotSchema.optional(),
    stages: z.array(missionStageSnapshotSchema),
    tasks: z.array(missionTaskSnapshotSchema),
    artifacts: z.array(missionArtifactSnapshotSchema),
    agentSessions: z.array(agentSessionSnapshotSchema),
    actions: missionActionListSnapshotSchema.optional(),
    control: z.record(z.string(), z.unknown()).optional(),
    worktree: missionWorktreeSnapshotSchema.optional()
}).strict();

export const missionProjectionSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    status: missionStatusSnapshotSchema.optional(),
    workflow: missionWorkflowSnapshotSchema.optional(),
    actions: missionActionListSnapshotSchema.optional(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const missionReadPayloadSchema = missionIdentityPayloadSchema;

export const missionReadProjectionPayloadSchema = missionIdentityPayloadSchema;

export const missionListActionsPayloadSchema = missionIdentityPayloadSchema.extend({
    context: missionActionQueryContextSchema.optional()
}).strict();

export const missionReadDocumentPayloadSchema = missionIdentityPayloadSchema.extend({
    path: z.string().trim().min(1)
}).strict();

export const missionReadWorktreePayloadSchema = missionIdentityPayloadSchema;

export const missionReadTerminalPayloadSchema = missionIdentityPayloadSchema;

export const missionEnsureTerminalPayloadSchema = missionIdentityPayloadSchema;

export const missionSendTerminalInputPayloadSchema = missionIdentityPayloadSchema.extend(
    missionTerminalInputSchema.shape
).strict();

export const missionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    command: missionMissionCommandSchema
}).strict();

export const missionTaskCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    taskId: z.string().trim().min(1),
    command: missionTaskCommandSchema
}).strict();

export const agentSessionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    sessionId: z.string().trim().min(1),
    command: agentSessionCommandSchema
}).strict();

export const missionExecuteActionPayloadSchema = missionIdentityPayloadSchema.extend({
    actionId: z.string().trim().min(1),
    steps: z.array(operatorActionExecutionStepSchema).optional(),
    terminalSessionName: z.string().trim().min(1).optional()
}).strict();

export const missionWriteDocumentPayloadSchema = missionIdentityPayloadSchema.extend({
    path: z.string().trim().min(1),
    content: z.string()
}).strict();

export const missionCommandMethodSchema = z.enum([
    'command',
    'taskCommand',
    'sessionCommand',
    'executeAction'
]);

export const missionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: missionCommandMethodSchema,
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    actionId: z.string().trim().min(1).optional()
}).strict();

export const missionDocumentWriteAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: z.literal('writeDocument'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    path: z.string().trim().min(1)
}).strict();

export const missionRemoteQueryPayloadSchemas = {
    read: missionReadPayloadSchema,
    readProjection: missionReadProjectionPayloadSchema,
    listActions: missionListActionsPayloadSchema,
    readDocument: missionReadDocumentPayloadSchema,
    readWorktree: missionReadWorktreePayloadSchema,
    readTerminal: missionReadTerminalPayloadSchema
} as const;

export const missionRemoteCommandPayloadSchemas = {
    command: missionCommandPayloadSchema,
    taskCommand: missionTaskCommandPayloadSchema,
    sessionCommand: agentSessionCommandPayloadSchema,
    executeAction: missionExecuteActionPayloadSchema,
    writeDocument: missionWriteDocumentPayloadSchema,
    ensureTerminal: missionEnsureTerminalPayloadSchema,
    sendTerminalInput: missionSendTerminalInputPayloadSchema
} as const;

export const missionRemoteQueryResultSchemas = {
    read: missionSnapshotSchema,
    readProjection: missionProjectionSnapshotSchema,
    listActions: missionActionListSnapshotSchema,
    readDocument: missionDocumentSnapshotSchema,
    readWorktree: missionWorktreeSnapshotSchema,
    readTerminal: missionTerminalSnapshotSchema
} as const;

export const missionRemoteCommandResultSchemas = {
    command: missionCommandAcknowledgementSchema,
    taskCommand: missionCommandAcknowledgementSchema,
    sessionCommand: missionCommandAcknowledgementSchema,
    executeAction: missionCommandAcknowledgementSchema,
    writeDocument: z.union([
        missionDocumentWriteAcknowledgementSchema,
        missionDocumentSnapshotSchema
    ]),
    ensureTerminal: missionTerminalSnapshotSchema,
    sendTerminalInput: missionTerminalSnapshotSchema
} as const;

export type MissionIdentityPayload = z.infer<typeof missionIdentityPayloadSchema>;
export type MissionEntityReference = z.infer<typeof missionEntityReferenceSchema>;
export type MissionChildEntityReference = z.infer<typeof missionChildEntityReferenceSchema>;
export type MissionReadPayload = z.infer<typeof missionReadPayloadSchema>;
export type MissionReadProjectionPayload = z.infer<typeof missionReadProjectionPayloadSchema>;
export type MissionListActionsPayload = z.infer<typeof missionListActionsPayloadSchema>;
export type MissionReadDocumentPayload = z.infer<typeof missionReadDocumentPayloadSchema>;
export type MissionReadWorktreePayload = z.infer<typeof missionReadWorktreePayloadSchema>;
export type MissionReadTerminalPayload = z.infer<typeof missionReadTerminalPayloadSchema>;
export type MissionEnsureTerminalPayload = z.infer<typeof missionEnsureTerminalPayloadSchema>;
export type MissionSendTerminalInputPayload = z.infer<typeof missionSendTerminalInputPayloadSchema>;
export type MissionCommandPayload = z.infer<typeof missionCommandPayloadSchema>;
export type MissionTaskCommandPayload = z.infer<typeof missionTaskCommandPayloadSchema>;
export type AgentSessionCommandPayloadType = z.infer<typeof agentSessionCommandPayloadSchema>;
export type MissionExecuteActionPayload = z.infer<typeof missionExecuteActionPayloadSchema>;
export type MissionWriteDocumentPayload = z.infer<typeof missionWriteDocumentPayloadSchema>;
export type MissionSnapshot = z.infer<typeof missionSnapshotSchema>;
export type MissionProjectionSnapshot = z.infer<typeof missionProjectionSnapshotSchema>;
export type MissionStorage = z.infer<typeof missionStorageSchema>;
export type MissionData = z.infer<typeof missionDataSchema>;
export type MissionDescriptor = z.infer<typeof missionDescriptorSchema>;
export type MissionStatusSnapshot = z.infer<typeof missionStatusSnapshotSchema>;
export type MissionWorkflowSnapshot = z.infer<typeof missionWorkflowSnapshotSchema>;
export type MissionMissionCommand = z.infer<typeof missionMissionCommandSchema>;
export type MissionTaskCommand = z.infer<typeof missionTaskCommandSchema>;
export type AgentSessionCommandType = z.infer<typeof agentSessionCommandSchema>;
export type MissionActionQueryContext = z.infer<typeof missionActionQueryContextSchema>;
export type MissionActionDescriptor = z.infer<typeof missionActionDescriptorSchema>;
export type MissionActionListSnapshot = z.infer<typeof missionActionListSnapshotSchema>;
export type MissionDocumentSnapshot = z.infer<typeof missionDocumentSnapshotSchema>;
export type MissionWorktreeNode = z.infer<typeof missionWorktreeNodeSchema>;
export type MissionWorktreeSnapshot = z.infer<typeof missionWorktreeSnapshotSchema>;
export type MissionCommandAcknowledgement = z.infer<typeof missionCommandAcknowledgementSchema>;
export type MissionDocumentWriteAcknowledgement = z.infer<typeof missionDocumentWriteAcknowledgementSchema>;

