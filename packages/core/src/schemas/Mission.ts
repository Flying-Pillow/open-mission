import { z } from 'zod/v4';
import { entityCommandAcknowledgementSchema } from './EntityRemote.js';

export const missionEntityName = 'Mission' as const;

export const missionEntityTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);

const agentMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

const agentMetadataSchema = z.record(z.string(), agentMetadataValueSchema);

export const missionAgentPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentMetadataSchema.optional()
}).strict();

export const missionAgentCommandSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interrupt'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('checkpoint'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('nudge'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('resume'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }).strict()
]);

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

export const missionSessionCommandSchema = z.discriminatedUnion('action', [
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
        prompt: missionAgentPromptSchema
    }).strict(),
    z.object({
        action: z.literal('command'),
        command: missionAgentCommandSchema
    }).strict()
]);

export const missionIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

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

export const missionArtifactSnapshotSchema = z.object({
    artifactId: z.string().trim().min(1),
    kind: z.enum(['mission', 'stage', 'task']),
    label: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    key: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
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
    relativePath: z.string().trim().min(1).optional()
}).strict();

export const missionStageSnapshotSchema = z.object({
    stageId: z.string().trim().min(1),
    lifecycle: z.string().trim().min(1),
    isCurrentStage: z.boolean(),
    artifacts: z.array(missionArtifactSnapshotSchema),
    tasks: z.array(missionTaskSnapshotSchema)
}).strict();

export const missionAgentSessionTerminalHandleSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
}).strict();

export const missionAgentSessionSnapshotSchema = z.object({
    sessionId: z.string().trim().min(1),
    runnerId: z.string().trim().min(1),
    transportId: z.string().trim().min(1).optional(),
    runnerLabel: z.string().trim().min(1),
    sessionLogPath: z.string().trim().min(1).optional(),
    lifecycleState: z.enum([
        'starting',
        'running',
        'awaiting-input',
        'completed',
        'failed',
        'cancelled',
        'terminated'
    ]),
    terminalSessionName: z.string().trim().min(1).optional(),
    terminalPaneId: z.string().trim().min(1).optional(),
    terminalHandle: missionAgentSessionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional()
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

export const missionDescriptorSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional(),
    type: missionEntityTypeSchema.optional(),
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    missionDir: z.string().trim().min(1).optional(),
    missionRootDir: z.string().trim().min(1).optional(),
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    artifacts: z.array(missionArtifactSnapshotSchema),
    stages: z.array(missionStageSnapshotSchema),
    agentSessions: z.array(missionAgentSessionSnapshotSchema).optional(),
    recommendedAction: z.string().trim().min(1).optional()
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
    agentSessions: z.array(missionAgentSessionSnapshotSchema),
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

export const missionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    command: missionMissionCommandSchema
}).strict();

export const missionTaskCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    taskId: z.string().trim().min(1),
    command: missionTaskCommandSchema
}).strict();

export const missionSessionCommandPayloadSchema = missionIdentityPayloadSchema.extend({
    sessionId: z.string().trim().min(1),
    command: missionSessionCommandSchema
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

export const missionCommandAcknowledgementSchema = entityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: missionCommandMethodSchema,
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    actionId: z.string().trim().min(1).optional()
}).strict();

export const missionDocumentWriteAcknowledgementSchema = entityCommandAcknowledgementSchema.extend({
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
    readWorktree: missionReadWorktreePayloadSchema
} as const;

export const missionRemoteCommandPayloadSchemas = {
    command: missionCommandPayloadSchema,
    taskCommand: missionTaskCommandPayloadSchema,
    sessionCommand: missionSessionCommandPayloadSchema,
    executeAction: missionExecuteActionPayloadSchema,
    writeDocument: missionWriteDocumentPayloadSchema
} as const;

export const missionRemoteQueryResultSchemas = {
    read: missionSnapshotSchema,
    readProjection: missionProjectionSnapshotSchema,
    listActions: missionActionListSnapshotSchema,
    readDocument: missionDocumentSnapshotSchema,
    readWorktree: missionWorktreeSnapshotSchema
} as const;

export const missionRemoteCommandResultSchemas = {
    command: missionCommandAcknowledgementSchema,
    taskCommand: missionCommandAcknowledgementSchema,
    sessionCommand: missionCommandAcknowledgementSchema,
    executeAction: missionCommandAcknowledgementSchema,
    writeDocument: z.union([
        missionDocumentWriteAcknowledgementSchema,
        missionDocumentSnapshotSchema
    ])
} as const;

export type MissionIdentityPayload = z.infer<typeof missionIdentityPayloadSchema>;
export type MissionReadPayload = z.infer<typeof missionReadPayloadSchema>;
export type MissionReadProjectionPayload = z.infer<typeof missionReadProjectionPayloadSchema>;
export type MissionListActionsPayload = z.infer<typeof missionListActionsPayloadSchema>;
export type MissionReadDocumentPayload = z.infer<typeof missionReadDocumentPayloadSchema>;
export type MissionReadWorktreePayload = z.infer<typeof missionReadWorktreePayloadSchema>;
export type MissionCommandPayload = z.infer<typeof missionCommandPayloadSchema>;
export type MissionTaskCommandPayload = z.infer<typeof missionTaskCommandPayloadSchema>;
export type MissionSessionCommandPayload = z.infer<typeof missionSessionCommandPayloadSchema>;
export type MissionExecuteActionPayload = z.infer<typeof missionExecuteActionPayloadSchema>;
export type MissionWriteDocumentPayload = z.infer<typeof missionWriteDocumentPayloadSchema>;
export type MissionSnapshot = z.infer<typeof missionSnapshotSchema>;
export type MissionProjectionSnapshot = z.infer<typeof missionProjectionSnapshotSchema>;
export type MissionDescriptor = z.infer<typeof missionDescriptorSchema>;
export type MissionStatusSnapshot = z.infer<typeof missionStatusSnapshotSchema>;
export type MissionWorkflowSnapshot = z.infer<typeof missionWorkflowSnapshotSchema>;
export type MissionStageSnapshot = z.infer<typeof missionStageSnapshotSchema>;
export type MissionTaskSnapshot = z.infer<typeof missionTaskSnapshotSchema>;
export type MissionArtifactSnapshot = z.infer<typeof missionArtifactSnapshotSchema>;
export type MissionAgentSessionSnapshot = z.infer<typeof missionAgentSessionSnapshotSchema>;
export type MissionAgentPrompt = z.infer<typeof missionAgentPromptSchema>;
export type MissionAgentCommand = z.infer<typeof missionAgentCommandSchema>;
export type MissionMissionCommand = z.infer<typeof missionMissionCommandSchema>;
export type MissionTaskCommand = z.infer<typeof missionTaskCommandSchema>;
export type MissionSessionCommand = z.infer<typeof missionSessionCommandSchema>;
export type MissionActionQueryContext = z.infer<typeof missionActionQueryContextSchema>;
export type MissionActionDescriptor = z.infer<typeof missionActionDescriptorSchema>;
export type MissionActionListSnapshot = z.infer<typeof missionActionListSnapshotSchema>;
export type MissionDocumentSnapshot = z.infer<typeof missionDocumentSnapshotSchema>;
export type MissionWorktreeNode = z.infer<typeof missionWorktreeNodeSchema>;
export type MissionWorktreeSnapshot = z.infer<typeof missionWorktreeSnapshotSchema>;
export type MissionCommandAcknowledgement = z.infer<typeof missionCommandAcknowledgementSchema>;
export type MissionDocumentWriteAcknowledgement = z.infer<typeof missionDocumentWriteAcknowledgementSchema>;
