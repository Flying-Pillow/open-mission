import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandInputDescriptorSchema,
    EntityIdSchema
} from '../Entity/EntitySchema.js';

export const agentExecutionEntityName = 'AgentExecution' as const;

export const AgentExecutionCommandIds = {
    complete: 'agentExecution.complete',
    cancel: 'agentExecution.cancel',
    sendPrompt: 'agentExecution.sendPrompt',
    sendRuntimeMessage: 'agentExecution.sendRuntimeMessage'
} as const;

export const AgentExecutionCommandIdSchema = z.enum([
    AgentExecutionCommandIds.complete,
    AgentExecutionCommandIds.cancel,
    AgentExecutionCommandIds.sendPrompt,
    AgentExecutionCommandIds.sendRuntimeMessage
]);

const agentExecutionMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

export type MissionAgentPrimitiveValue = string | number | boolean | null;

const agentExecutionMetadataSchema = z.record(z.string(), agentExecutionMetadataValueSchema);

export const AgentExecutionPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentExecutionMetadataSchema.optional()
}).strict();

export const AgentExecutionCommandSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interrupt'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentExecutionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('checkpoint'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentExecutionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('nudge'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentExecutionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('resume'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentExecutionMetadataSchema.optional()
    }).strict()
]);

export const AgentExecutionInteractionModeSchema = z.enum([
    'pty-terminal',
    'agent-message',
    'read-only'
]);

export const AgentExecutionInteractionCapabilitiesSchema = z.object({
    mode: AgentExecutionInteractionModeSchema,
    canSendTerminalInput: z.boolean(),
    canSendStructuredPrompt: z.boolean(),
    canSendStructuredCommand: z.boolean(),
    reason: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionEventSubjectSchema = AgentExecutionLocatorSchema.extend({
    entity: z.literal(agentExecutionEntityName)
}).strict();

export const AgentExecutionCommandInputSchema = AgentExecutionLocatorSchema.extend({
    commandId: AgentExecutionCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const AgentExecutionSendTerminalInputSchema = AgentExecutionLocatorSchema.extend({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'AgentExecution terminal input requires data or a complete cols/rows resize payload.'
});

export const AgentExecutionTerminalHandleSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1),
    sharedTerminalName: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTerminalRouteParamsSchema = z.object({
    sessionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalQuerySchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRouteInputSchema = z.object({
    missionId: z.string().trim().min(1),
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Agent execution terminal input requires data or a complete cols/rows resize payload.'
});

export const AgentExecutionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const AgentExecutionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const AgentExecutionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const AgentExecutionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: AgentExecutionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: AgentExecutionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: AgentExecutionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export const AgentExecutionContextArtifactRoleSchema = z.enum([
    'instruction',
    'reference',
    'evidence',
    'output'
]);

export const AgentExecutionContextArtifactSchema = z.object({
    id: z.string().trim().min(1),
    role: AgentExecutionContextArtifactRoleSchema,
    order: z.number().int().nonnegative(),
    title: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionContextInstructionSchema = z.object({
    instructionId: z.string().trim().min(1),
    text: z.string(),
    order: z.number().int().nonnegative()
}).strict();

export const AgentExecutionContextSchema = z.object({
    artifacts: z.array(AgentExecutionContextArtifactSchema),
    instructions: z.array(AgentExecutionContextInstructionSchema)
}).strict();

export const AgentExecutionMessageDescriptorSchema = z.object({
    type: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    delivery: z.enum(['best-effort']),
    mutatesContext: z.boolean(),
    input: EntityCommandInputDescriptorSchema.optional()
}).strict();

export const AgentExecutionRuntimeCommandTypeSchema = z.enum([
    'interrupt',
    'checkpoint',
    'nudge',
    'resume'
]);

export type AgentExecutionTerminalRouteParamsType = z.infer<typeof AgentExecutionTerminalRouteParamsSchema>;
export type AgentExecutionTerminalQueryType = z.infer<typeof AgentExecutionTerminalQuerySchema>;
export type AgentExecutionTerminalRouteInputType = z.infer<typeof AgentExecutionTerminalRouteInputSchema>;
export type AgentExecutionTerminalSnapshotType = z.infer<typeof AgentExecutionTerminalSnapshotSchema>;
export type AgentExecutionTerminalSocketClientMessageType = z.infer<typeof AgentExecutionTerminalSocketClientMessageSchema>;
export type AgentExecutionTerminalOutputType = z.infer<typeof AgentExecutionTerminalOutputSchema>;
export type AgentExecutionTerminalSocketServerMessageType = z.infer<typeof AgentExecutionTerminalSocketServerMessageSchema>;
export type AgentExecutionContextArtifactRoleType = z.infer<typeof AgentExecutionContextArtifactRoleSchema>;
export type AgentExecutionContextArtifactType = z.infer<typeof AgentExecutionContextArtifactSchema>;
export type AgentExecutionContextInstructionType = z.infer<typeof AgentExecutionContextInstructionSchema>;
export type AgentExecutionContextType = z.infer<typeof AgentExecutionContextSchema>;
export type AgentExecutionMessageDescriptorType = z.infer<typeof AgentExecutionMessageDescriptorSchema>;
export type AgentExecutionRuntimeCommandType = z.infer<typeof AgentExecutionRuntimeCommandTypeSchema>;

export const AgentExecutionLifecycleStateSchema = z.enum([
    'starting',
    'running',
    'awaiting-input',
    'completed',
    'failed',
    'cancelled',
    'terminated'
]);

export type AgentExecutionLifecycleStateType = z.infer<typeof AgentExecutionLifecycleStateSchema>;
export type AgentExecutionInteractionModeType = z.infer<typeof AgentExecutionInteractionModeSchema>;
export type AgentExecutionInteractionCapabilitiesType = z.infer<typeof AgentExecutionInteractionCapabilitiesSchema>;

export type MissionAgentLifecycleState = AgentExecutionLifecycleStateType;

export type MissionAgentPermissionKind =
    | 'input'
    | 'tool'
    | 'filesystem'
    | 'command'
    | 'unknown';

export type MissionAgentPermissionRequest = {
    id: string;
    kind: MissionAgentPermissionKind;
    prompt: string;
    options: string[];
    providerDetails?: Record<string, MissionAgentPrimitiveValue>;
};

export type MissionAgentModelInfo = {
    id?: string;
    family?: string;
    provider?: string;
    displayName?: string;
};

export type MissionAgentTelemetrySnapshot = {
    model?: MissionAgentModelInfo;
    providerSessionId?: string;
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    contextWindow?: {
        usedTokens?: number;
        maxTokens?: number;
        utilization?: number;
    };
    estimatedCostUsd?: number;
    activeToolName?: string;
    updatedAt: string;
};

export type MissionAgentScope =
    | {
        kind: 'control';
        workspaceRoot?: string;
        repoName?: string;
        branch?: string;
    }
    | {
        kind: 'mission';
        missionId?: string;
        stage?: string;
        currentSlice?: string;
        readyTaskIds?: string[];
        readyTaskTitle?: string;
        readyTaskInstruction?: string;
    }
    | {
        kind: 'artifact';
        missionId?: string;
        stage?: string;
        artifactKey: string;
        artifactPath?: string;
        checkpoint?: string;
        validation?: string;
    }
    | {
        kind: 'slice';
        missionId?: string;
        missionDir?: string;
        stage?: string;
        sliceTitle: string;
        sliceId?: string;
        taskId?: string;
        taskTitle?: string;
        taskSummary?: string;
        taskInstruction?: string;
        doneWhen?: string[];
        stopCondition?: string;
        verificationTargets: string[];
        requiredSkills: string[];
        dependsOn: string[];
    }
    | {
        kind: 'gate';
        missionId?: string;
        stage?: string;
        intent: string;
    };

export type MissionAgentTurnRequest = {
    workingDirectory: string;
    prompt: string;
    scope?: MissionAgentScope;
    title?: string;
    operatorIntent?: string;
    startFreshSession?: boolean;
};

export type AgentExecutionState = {
    agentId: string;
    transportId?: string;
    adapterLabel: string;
    sessionId: string;
    sessionLogPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
    lifecycleState: MissionAgentLifecycleState;
    workingDirectory?: string;
    currentTurnTitle?: string;
    interactionCapabilities: AgentExecutionInteractionCapabilitiesType;
    runtimeMessages: AgentExecutionMessageDescriptorType[];
    scope?: MissionAgentScope;
    awaitingPermission?: MissionAgentPermissionRequest;
    telemetry?: MissionAgentTelemetrySnapshot;
    failureMessage?: string;
    lastUpdatedAt: string;
};

export type AgentExecutionRecord = {
    sessionId: string;
    agentId: string;
    transportId?: string;
    adapterLabel: string;
    sessionLogPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
    lifecycleState: MissionAgentLifecycleState;
    taskId?: string;
    assignmentLabel?: string;
    workingDirectory?: string;
    currentTurnTitle?: string;
    interactionCapabilities: AgentExecutionInteractionCapabilitiesType;
    runtimeMessages: AgentExecutionMessageDescriptorType[];
    scope?: MissionAgentScope;
    telemetry?: MissionAgentTelemetrySnapshot;
    failureMessage?: string;
    createdAt: string;
    lastUpdatedAt: string;
};

export type AgentExecutionLaunchRequest = MissionAgentTurnRequest & {
    agentId: string;
    terminalName?: string;
    transportId?: string;
    sessionId?: string;
    taskId?: string;
    assignmentLabel?: string;
};

export const AgentExecutionStorageSchema = z.object({
    id: EntityIdSchema,
    sessionId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    transportId: z.string().trim().min(1).optional(),
    adapterLabel: z.string().trim().min(1),
    sessionLogPath: z.string().trim().min(1).optional(),
    lifecycleState: AgentExecutionLifecycleStateSchema,
    terminalHandle: AgentExecutionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    interactionCapabilities: AgentExecutionInteractionCapabilitiesSchema,
    context: AgentExecutionContextSchema,
    runtimeMessages: z.array(AgentExecutionMessageDescriptorSchema),
    scope: z.unknown().optional(),
    telemetry: z.unknown().optional(),
    failureMessage: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionDataSchema = z.object({
    ...AgentExecutionStorageSchema.shape
}).strict();

export const AgentExecutionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(agentExecutionEntityName),
    method: z.literal('command'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    commandId: AgentExecutionCommandIdSchema.optional()
}).strict();

export const AgentExecutionDataChangedSchema = z.object({
    reference: AgentExecutionEventSubjectSchema,
    data: AgentExecutionDataSchema
}).strict();

export type AgentExecutionLocatorType = z.infer<typeof AgentExecutionLocatorSchema>;
export type AgentExecutionEventSubjectType = z.infer<typeof AgentExecutionEventSubjectSchema>;
export type AgentExecutionCommandIdType = z.infer<typeof AgentExecutionCommandIdSchema>;
export type AgentExecutionCommandInputType = z.infer<typeof AgentExecutionCommandInputSchema>;
export type AgentExecutionSendTerminalInputType = z.infer<typeof AgentExecutionSendTerminalInputSchema>;
export type AgentExecutionPromptType = z.infer<typeof AgentExecutionPromptSchema>;
export type AgentExecutionCommandType = z.infer<typeof AgentExecutionCommandSchema>;
export type AgentExecutionTerminalHandleType = z.infer<typeof AgentExecutionTerminalHandleSchema>;
export type AgentExecutionStorageType = z.infer<typeof AgentExecutionStorageSchema>;
export type AgentExecutionDataType = z.infer<typeof AgentExecutionDataSchema>;
export type AgentExecutionCommandAcknowledgementType = z.infer<typeof AgentExecutionCommandAcknowledgementSchema>;
export type AgentExecutionDataChangedType = z.infer<typeof AgentExecutionDataChangedSchema>;
