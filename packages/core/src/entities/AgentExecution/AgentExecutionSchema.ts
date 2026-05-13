import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntitySchema,
    EntityStorageSchema
} from '../Entity/EntitySchema.js';
import {
    agentExecutionEntityName,
    AgentExecutionCommandIdSchema,
    AgentExecutionContextArtifactRoleSchema,
    AgentExecutionEventSubjectSchema,
    AgentExecutionInteractionCapabilitiesSchema,
    AgentExecutionInteractionPostureSchema,
    AgentExecutionMessageDescriptorSchema,
    AgentExecutionProtocolDescriptorSchema,
    AgentExecutionScopeSchema,
    type AgentExecutionInteractionCapabilitiesType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionScopeType
} from './protocol/AgentExecutionProtocolSchema.js';
import { AgentExecutionProjectionSchema } from './state/AgentExecutionProjectionSchema.js';
import {
    AgentExecutionActivityStateSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionLifecycleStateSchema,
    AgentExecutionProgressSchema,
    AgentExecutionPermissionRequestSchema,
    AgentExecutionRuntimeCommandTypeSchema,
    AgentExecutionRuntimeActivitySchema,
    AgentExecutionTelemetrySchema,
    AgentExecutionTransportStateSchema,
    type AgentExecutionPermissionRequest,
    type AgentExecutionActivityStateType,
    type AgentExecutionAttentionStateType,
    type AgentExecutionLifecycleStateType,
    type AgentExecutionRuntimeActivityType,
    type AgentExecutionTelemetry,
    type AgentExecutionTransportStateType
} from './state/AgentExecutionStateSchema.js';
import {
    AgentExecutionReferenceSchema,
    AgentExecutionTerminalTransportSchema,
    AgentExecutionTerminalHandleSchema,
    AgentExecutionTerminalRecordingPathSchema,
    type AgentExecutionTerminalHandleType
} from './state/AgentExecutionTransportSchema.js';

export * from './state/AgentExecutionTransportSchema.js';
export * from './state/AgentExecutionStateSchema.js';
export * from './protocol/AgentExecutionProtocolSchema.js';
export * from './protocol/AgentExecutionSemanticOperationSchema.js';
export * from './state/AgentExecutionProjectionSchema.js';

export const AgentExecutionJournalPathSchema = z.string()
    .trim()
    .min(1)
    .refine((value) => /^agent-journals\/[^/]+\.interaction\.jsonl$/u.test(value), {
        message: 'AgentExecution journals must use agent-journals/<agentExecutionId>.interaction.jsonl.'
    });

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

export type AgentExecutionTurnRequest = {
    workingDirectory: string;
    prompt: string;
    scope?: AgentExecutionScopeType;
    title?: string;
    operatorIntent?: string;
    startFreshAgentExecution?: boolean;
};

export type AgentExecutionState = {
    agentId: string;
    transportId?: string;
    adapterLabel: string;
    agentExecutionId: string;
    agentJournalPath?: string;
    terminalRecordingPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
    lifecycleState: AgentExecutionLifecycleStateType;
    attention?: AgentExecutionAttentionStateType;
    activityState?: AgentExecutionActivityStateType;
    currentInputRequestId?: string | null;
    awaitingResponseToMessageId?: string | null;
    workingDirectory?: string;
    currentTurnTitle?: string;
    interactionCapabilities: AgentExecutionInteractionCapabilitiesType;
    runtimeMessages: AgentExecutionMessageDescriptorType[];
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    scope?: AgentExecutionScopeType;
    runtimeActivity?: AgentExecutionRuntimeActivityType;
    awaitingPermission?: AgentExecutionPermissionRequest;
    telemetry?: AgentExecutionTelemetry;
    failureMessage?: string;
    lastUpdatedAt: string;
};

export type AgentExecutionConsoleState = {
    title?: string;
    lines: string[];
    promptOptions: string[] | null;
    awaitingInput: boolean;
    agentId?: string;
    adapterLabel?: string;
    agentExecutionId?: string;
};

export type AgentExecutionConsoleEvent =
    | {
        type: 'reset';
        state: AgentExecutionConsoleState;
    }
    | {
        type: 'lines';
        lines: string[];
        state: AgentExecutionConsoleState;
    }
    | {
        type: 'prompt';
        state: AgentExecutionConsoleState;
    };

export type AgentExecutionOwnerEvent =
    | {
        type: 'agent-execution-state-changed';
        state: AgentExecutionState;
    }
    | {
        type: 'prompt-accepted';
        prompt: string;
        state: AgentExecutionState;
    }
    | {
        type: 'prompt-rejected';
        prompt: string;
        reason: string;
        state: AgentExecutionState;
    }
    | {
        type: 'agent-execution-started';
        state: AgentExecutionState;
    }
    | {
        type: 'agent-execution-resumed';
        state: AgentExecutionState;
    }
    | {
        type: 'agent-message';
        channel: 'stdout' | 'stderr' | 'system';
        text: string;
        state: AgentExecutionState;
    }
    | {
        type: 'permission-requested';
        request: AgentExecutionPermissionRequest;
        state: AgentExecutionState;
    }
    | {
        type: 'tool-started';
        toolName: string;
        summary?: string;
        state: AgentExecutionState;
    }
    | {
        type: 'tool-finished';
        toolName: string;
        summary?: string;
        state: AgentExecutionState;
    }
    | {
        type: 'telemetry-updated';
        telemetry: AgentExecutionTelemetry;
        state: AgentExecutionState;
    }
    | {
        type: 'context-updated';
        telemetry: AgentExecutionTelemetry;
        state: AgentExecutionState;
    }
    | {
        type: 'cost-updated';
        telemetry: AgentExecutionTelemetry;
        state: AgentExecutionState;
    }
    | {
        type: 'agent-execution-completed';
        exitCode: number;
        state: AgentExecutionState;
    }
    | {
        type: 'agent-execution-failed';
        errorMessage: string;
        exitCode?: number;
        state: AgentExecutionState;
    }
    | {
        type: 'agent-execution-cancelled';
        reason?: string;
        state: AgentExecutionState;
    };

export type AgentExecutionRecord = {
    agentExecutionId: string;
    agentId: string;
    transportId?: string;
    adapterLabel: string;
    agentJournalPath?: string;
    terminalRecordingPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
    lifecycleState: AgentExecutionLifecycleStateType;
    attention?: AgentExecutionAttentionStateType;
    activityState?: AgentExecutionActivityStateType;
    currentInputRequestId?: string | null;
    awaitingResponseToMessageId?: string | null;
    taskId?: string;
    assignmentLabel?: string;
    workingDirectory?: string;
    currentTurnTitle?: string;
    interactionCapabilities: AgentExecutionInteractionCapabilitiesType;
    runtimeMessages: AgentExecutionMessageDescriptorType[];
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    scope?: AgentExecutionScopeType;
    runtimeActivity?: AgentExecutionRuntimeActivityType;
    telemetry?: AgentExecutionTelemetry;
    failureMessage?: string;
    createdAt: string;
    lastUpdatedAt: string;
};

export type AgentExecutionLaunchRequest = AgentExecutionTurnRequest & {
    agentId: string;
    terminalName?: string;
    transportId?: string;
    agentExecutionId?: string;
    taskId?: string;
    assignmentLabel?: string;
};

export const AgentExecutionStorageSchema = EntityStorageSchema.extend({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    transportId: z.string().trim().min(1).optional(),
    adapterLabel: z.string().trim().min(1),
    agentJournalPath: AgentExecutionJournalPathSchema.optional(),
    journalRecords: z.array(z.any()).optional(),
    terminalRecordingPath: AgentExecutionTerminalRecordingPathSchema.optional(),
    lifecycleState: AgentExecutionLifecycleStateSchema,
    attention: AgentExecutionAttentionStateSchema.optional(),
    activityState: AgentExecutionActivityStateSchema.optional(),
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    awaitingResponseToMessageId: z.string().trim().min(1).nullable().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    interactionCapabilities: AgentExecutionInteractionCapabilitiesSchema,
    context: AgentExecutionContextSchema,
    projection: AgentExecutionProjectionSchema.default({ timelineItems: [] }),
    runtimeMessages: z.array(AgentExecutionMessageDescriptorSchema),
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema.optional(),
    transportState: AgentExecutionTransportStateSchema.optional(),
    scope: AgentExecutionScopeSchema.optional(),
    progress: AgentExecutionProgressSchema.optional(),
    waitingForInput: z.boolean().optional(),
    acceptsPrompts: z.boolean().optional(),
    acceptedCommands: z.array(AgentExecutionRuntimeCommandTypeSchema).optional(),
    interactionPosture: AgentExecutionInteractionPostureSchema.optional(),
    transport: AgentExecutionTerminalTransportSchema.optional(),
    reference: AgentExecutionReferenceSchema.optional(),
    runtimeActivity: AgentExecutionRuntimeActivitySchema.optional(),
    awaitingPermission: AgentExecutionPermissionRequestSchema.optional(),
    telemetry: AgentExecutionTelemetrySchema.optional(),
    failureMessage: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional(),
    endedAt: z.string().trim().min(1).optional()
}).strict();

const AgentExecutionStoragePayloadSchema = AgentExecutionStorageSchema.omit({ id: true });

export const AgentExecutionSchema = EntitySchema.extend({
    ...AgentExecutionStoragePayloadSchema.shape
}).strict();

export const AgentExecutionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(agentExecutionEntityName),
    method: z.literal('command'),
    id: z.string().trim().min(1),
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    commandId: AgentExecutionCommandIdSchema.optional()
}).strict();

export const AgentExecutionChangedSchema = z.object({
    reference: AgentExecutionEventSubjectSchema,
    execution: AgentExecutionSchema
}).strict();

export type AgentExecutionContextArtifactRoleType = z.infer<typeof AgentExecutionContextArtifactRoleSchema>;
export type AgentExecutionContextArtifactType = z.infer<typeof AgentExecutionContextArtifactSchema>;
export type AgentExecutionContextInstructionType = z.infer<typeof AgentExecutionContextInstructionSchema>;
export type AgentExecutionContextType = z.infer<typeof AgentExecutionContextSchema>;
export type AgentExecutionJournalPathType = z.infer<typeof AgentExecutionJournalPathSchema>;
export type AgentExecutionStorageType = z.infer<typeof AgentExecutionStorageSchema>;
export type AgentExecutionType = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionCommandAcknowledgementType = z.infer<typeof AgentExecutionCommandAcknowledgementSchema>;
export type AgentExecutionChangedType = z.infer<typeof AgentExecutionChangedSchema>;