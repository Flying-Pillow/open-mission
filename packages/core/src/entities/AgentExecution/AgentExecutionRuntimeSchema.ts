import { z } from 'zod/v4';
import {
    AgentExecutionInteractionCapabilitiesSchema,
    AgentExecutionInteractionPostureSchema,
    AgentExecutionScopeSchema,
    AgentSignalDeliverySchema
} from './AgentExecutionProtocolSchema.js';
import {
    AgentExecutionReferenceSchema,
    AgentExecutionTerminalTransportSchema
} from './AgentExecutionTransportSchema.js';

export type AgentExecutionPrimitiveValue = string | number | boolean | null;

const agentExecutionMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

export const AgentExecutionTransportStateSchema = z.object({
    selected: AgentSignalDeliverySchema,
    degraded: z.boolean().default(false),
    health: z.enum([
        'attached',
        'detached',
        'degraded',
        'orphaned',
        'protocol-incompatible',
        'reconciling'
    ]).optional(),
    reason: z.string().trim().min(1).optional(),
    daemonProtocolVersion: z.number().int().positive().optional(),
    executionProtocolVersion: z.number().int().positive().optional(),
    terminalAttached: z.boolean().optional(),
    leaseAttached: z.boolean().optional(),
    ownerMatched: z.boolean().optional(),
    commandable: z.boolean().optional(),
    signalCompatible: z.boolean().optional(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionRuntimeCommandTypeSchema = z.enum([
    'interrupt',
    'checkpoint',
    'nudge',
    'resume'
]);

export const AgentExecutionLifecycleStateSchema = z.enum([
    'starting',
    'running',
    'completed',
    'failed',
    'cancelled',
    'terminated'
]);

export const AgentExecutionAttentionStateSchema = z.enum([
    'none',
    'autonomous',
    'awaiting-operator',
    'awaiting-system',
    'blocked'
]);

export const AgentExecutionActivityStateSchema = z.enum([
    'idle',
    'awaiting-agent-response',
    'planning',
    'reasoning',
    'communicating',
    'editing',
    'executing',
    'testing',
    'reviewing'
]);

export const AgentProgressStateSchema = z.enum([
    'initializing',
    'unknown',
    'working',
    'idle',
    'waiting-input',
    'blocked',
    'done',
    'failed'
]);

export type AgentExecutionPermissionKind =
    | 'input'
    | 'tool'
    | 'filesystem'
    | 'command'
    | 'unknown';

export type AgentExecutionPermissionRequest = {
    id: string;
    kind: AgentExecutionPermissionKind;
    prompt: string;
    options: string[];
    providerDetails?: Record<string, AgentExecutionPrimitiveValue>;
};

export const AgentExecutionPermissionRequestSchema = z.object({
    id: z.string().trim().min(1),
    kind: z.enum(['input', 'tool', 'filesystem', 'command', 'unknown']),
    prompt: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)),
    providerDetails: z.record(z.string(), agentExecutionMetadataValueSchema).optional()
}).strict();

export const AgentExecutionModelInfoSchema = z.object({
    id: z.string().trim().min(1).optional(),
    family: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    displayName: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTelemetrySnapshotSchema = z.object({
    model: AgentExecutionModelInfoSchema.optional(),
    providerAgentExecutionId: z.string().trim().min(1).optional(),
    tokenUsage: z.object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional()
    }).strict().optional(),
    contextWindow: z.object({
        usedTokens: z.number().int().nonnegative().optional(),
        maxTokens: z.number().int().positive().optional(),
        utilization: z.number().nonnegative().optional()
    }).strict().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    activeToolName: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionActivityProgressSchema = z.object({
    summary: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    units: z.object({
        completed: z.number().nonnegative().optional(),
        total: z.number().nonnegative().optional(),
        unit: z.string().trim().min(1).optional()
    }).strict().optional()
}).strict();

export const AgentExecutionCapabilitySnapshotSchema = z.object({
    terminalAttached: z.boolean().optional(),
    streaming: z.boolean().optional(),
    toolCallActive: z.boolean().optional(),
    filesystemMutating: z.boolean().optional()
}).strict();

export const AgentExecutionActivityTargetSchema = z.object({
    kind: z.enum(['file', 'command', 'tool', 'artifact', 'unknown']),
    label: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionRuntimeActivitySnapshotSchema = z.object({
    progress: AgentExecutionActivityProgressSchema.optional(),
    capabilities: AgentExecutionCapabilitySnapshotSchema.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentProgressSnapshotSchema = z.object({
    state: AgentProgressStateSchema,
    summary: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    units: z.object({
        completed: z.number().nonnegative().optional(),
        total: z.number().nonnegative().optional(),
        unit: z.string().trim().min(1).optional()
    }).strict().optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionSnapshotSchema = z.object({
    agentId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    scope: AgentExecutionScopeSchema,
    workingDirectory: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    missionId: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    status: AgentExecutionLifecycleStateSchema,
    attention: AgentExecutionAttentionStateSchema,
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    progress: AgentProgressSnapshotSchema,
    waitingForInput: z.boolean(),
    acceptsPrompts: z.boolean(),
    acceptedCommands: z.array(AgentExecutionRuntimeCommandTypeSchema),
    interactionPosture: AgentExecutionInteractionPostureSchema,
    interactionCapabilities: AgentExecutionInteractionCapabilitiesSchema.optional(),
    transport: AgentExecutionTerminalTransportSchema.optional(),
    reference: AgentExecutionReferenceSchema,
    failureMessage: z.string().trim().min(1).optional(),
    startedAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    endedAt: z.string().trim().min(1).optional()
}).strict();

export type AgentExecutionTransportStateType = z.infer<typeof AgentExecutionTransportStateSchema>;
export type AgentExecutionRuntimeCommandType = z.infer<typeof AgentExecutionRuntimeCommandTypeSchema>;
export type AgentExecutionLifecycleStateType = z.infer<typeof AgentExecutionLifecycleStateSchema>;
export type AgentExecutionAttentionStateType = z.infer<typeof AgentExecutionAttentionStateSchema>;
export type AgentExecutionActivityStateType = z.infer<typeof AgentExecutionActivityStateSchema>;
export type AgentProgressStateType = z.infer<typeof AgentProgressStateSchema>;
export type AgentExecutionModelInfo = z.infer<typeof AgentExecutionModelInfoSchema>;
export type AgentExecutionTelemetrySnapshot = z.infer<typeof AgentExecutionTelemetrySnapshotSchema>;
export type AgentExecutionActivityProgressType = z.infer<typeof AgentExecutionActivityProgressSchema>;
export type AgentExecutionCapabilitySnapshotType = z.infer<typeof AgentExecutionCapabilitySnapshotSchema>;
export type AgentExecutionActivityTargetType = z.infer<typeof AgentExecutionActivityTargetSchema>;
export type AgentExecutionRuntimeActivitySnapshotType = z.infer<typeof AgentExecutionRuntimeActivitySnapshotSchema>;
export type AgentProgressSnapshotType = z.infer<typeof AgentProgressSnapshotSchema>;
export type AgentExecutionSnapshotType = z.infer<typeof AgentExecutionSnapshotSchema>;