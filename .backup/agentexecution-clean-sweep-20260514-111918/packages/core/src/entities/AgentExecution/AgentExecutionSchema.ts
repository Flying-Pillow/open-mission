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
    type AgentExecutionCommandType,
    type AgentExecutionInteractionCapabilitiesType,
    type AgentExecutionPromptType,
    type AgentStatusSignalPayloadType
} from './AgentExecutionCommunicationSchema.js';
import {
    AgentExecutionActivityStateSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionLifecycleStateSchema,
    AgentExecutionProgressSchema,
    AgentExecutionPermissionRequestSchema,
    AgentExecutionSupportedCommandTypeSchema,
    AgentExecutionLiveActivitySchema,
    AgentExecutionTelemetrySchema,
    AgentExecutionTransportStateSchema,
    type AgentExecutionProgressType,
    type AgentProgressStateType
} from './AgentExecutionStateSchema.js';
import {
    AgentExecutionTimelineSchema,
    type AgentExecutionTimelineItemType
} from './activity/AgentExecutionActivityTimelineSchema.js';
import {
    AgentExecutionReferenceSchema,
    AgentExecutionTerminalTransportSchema,
    AgentExecutionTerminalHandleSchema,
    AgentExecutionTerminalRecordingPathSchema
} from './terminal/AgentExecutionTerminalSchema.js';
import type {
    AgentExecutionReferenceType,
    AgentExecutionTerminalTransportType
} from './terminal/AgentExecutionTerminalSchema.js';
import type {
    AgentExecutionJournalInputChoiceType,
    AgentExecutionJournalSignalConfidenceType,
    AgentExecutionJournalSignalSourceType,
    AgentExecutionJournalSignalType
} from './observations/AgentExecutionObservationSignalRegistry.js';

export * from './terminal/AgentExecutionTerminalSchema.js';
export * from './AgentExecutionStateSchema.js';
export * from './AgentExecutionCommunicationSchema.js';
export * from './input/AgentExecutionSemanticOperationSchema.js';
export * from './activity/AgentExecutionActivityTimelineSchema.js';

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

export const AgentExecutionTurnRequestSchema = z.object({
    ownerId: z.string().trim().min(1),
    workingDirectory: z.string().trim().min(1),
    prompt: z.string(),
    title: z.string().trim().min(1).optional(),
    operatorIntent: z.string().trim().min(1).optional(),
    startFreshAgentExecution: z.boolean().optional()
}).strict();

export const AgentExecutionConsoleStateSchema = z.object({
    title: z.string().trim().min(1).optional(),
    lines: z.array(z.string()),
    promptOptions: z.array(z.string()).nullable(),
    awaitingInput: z.boolean(),
    agentId: z.string().trim().min(1).optional(),
    adapterLabel: z.string().trim().min(1).optional(),
    agentExecutionId: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionConsoleEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('reset'), state: AgentExecutionConsoleStateSchema }).strict(),
    z.object({ type: z.literal('lines'), lines: z.array(z.string()), state: AgentExecutionConsoleStateSchema }).strict(),
    z.object({ type: z.literal('prompt'), state: AgentExecutionConsoleStateSchema }).strict()
]);

export const AgentExecutionLaunchRequestSchema = AgentExecutionTurnRequestSchema.extend({
    agentId: z.string().trim().min(1),
    terminalName: z.string().trim().min(1).optional(),
    transportId: z.string().trim().min(1).optional(),
    agentExecutionId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    assignmentLabel: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionProcessSchema = z.object({
    agentId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    ownerId: z.string().trim().min(1),
    workingDirectory: z.string().trim().min(1),
    status: AgentExecutionLifecycleStateSchema,
    attention: AgentExecutionAttentionStateSchema.optional(),
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    progress: AgentExecutionProgressSchema,
    waitingForInput: z.boolean(),
    acceptsPrompts: z.boolean(),
    acceptedCommands: z.array(AgentExecutionSupportedCommandTypeSchema),
    interactionPosture: AgentExecutionInteractionPostureSchema,
    interactionCapabilities: AgentExecutionInteractionCapabilitiesSchema,
    transport: AgentExecutionTerminalTransportSchema.optional(),
    reference: AgentExecutionReferenceSchema,
    startedAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    failureMessage: z.string().trim().min(1).optional(),
    endedAt: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionStorageSchema = EntityStorageSchema.extend({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    process: AgentExecutionProcessSchema,
    adapterLabel: z.string().trim().min(1),
    agentJournalPath: AgentExecutionJournalPathSchema.optional(),
    terminalRecordingPath: AgentExecutionTerminalRecordingPathSchema.optional(),
    lifecycleState: AgentExecutionLifecycleStateSchema,
    attention: AgentExecutionAttentionStateSchema.optional(),
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    awaitingResponseToMessageId: z.string().trim().min(1).nullable().optional(),
    context: AgentExecutionContextSchema,
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema.optional(),
    transportState: AgentExecutionTransportStateSchema.optional(),
    failureMessage: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional(),
    endedAt: z.string().trim().min(1).optional()
}).strict();

const AgentExecutionStoragePayloadSchema = AgentExecutionStorageSchema.omit({ id: true });

export const AgentExecutionSchema = EntitySchema.extend({
    ...AgentExecutionStoragePayloadSchema.shape,
    transportId: z.string().trim().min(1).optional(),
    journalRecords: z.array(z.any()).optional(),
    activityState: AgentExecutionActivityStateSchema.optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    interactionCapabilities: AgentExecutionInteractionCapabilitiesSchema,
    timeline: AgentExecutionTimelineSchema.default({ timelineItems: [] }),
    supportedMessages: z.array(AgentExecutionMessageDescriptorSchema),
    progress: AgentExecutionProgressSchema.optional(),
    waitingForInput: z.boolean().optional(),
    acceptsPrompts: z.boolean().optional(),
    acceptedCommands: z.array(AgentExecutionSupportedCommandTypeSchema).optional(),
    interactionPosture: AgentExecutionInteractionPostureSchema.optional(),
    transport: AgentExecutionTerminalTransportSchema.optional(),
    reference: AgentExecutionReferenceSchema.optional(),
    liveActivity: AgentExecutionLiveActivitySchema.optional(),
    awaitingPermission: AgentExecutionPermissionRequestSchema.optional(),
    telemetry: AgentExecutionTelemetrySchema.optional()
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

export const AgentExecutionEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('agent-execution-changed'), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('prompt-accepted'), prompt: z.string(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('prompt-rejected'), prompt: z.string(), reason: z.string().trim().min(1), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-execution-started'), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-execution-resumed'), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-message'), channel: z.enum(['stdout', 'stderr', 'system']), text: z.string(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('permission-requested'), request: AgentExecutionPermissionRequestSchema, execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('tool-started'), toolName: z.string().trim().min(1), summary: z.string().trim().min(1).optional(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('tool-finished'), toolName: z.string().trim().min(1), summary: z.string().trim().min(1).optional(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('telemetry-updated'), telemetry: AgentExecutionTelemetrySchema, execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('context-updated'), telemetry: AgentExecutionTelemetrySchema, execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('cost-updated'), telemetry: AgentExecutionTelemetrySchema, execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-execution-completed'), exitCode: z.number().int(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-execution-failed'), errorMessage: z.string().trim().min(1), exitCode: z.number().int().optional(), execution: AgentExecutionSchema }).strict(),
    z.object({ type: z.literal('agent-execution-cancelled'), reason: z.string().trim().min(1).optional(), execution: AgentExecutionSchema }).strict()
]);

export type AgentExecutionContextArtifactRoleType = z.infer<typeof AgentExecutionContextArtifactRoleSchema>;
export type AgentExecutionContextArtifactType = z.infer<typeof AgentExecutionContextArtifactSchema>;
export type AgentExecutionContextInstructionType = z.infer<typeof AgentExecutionContextInstructionSchema>;
export type AgentExecutionContextType = z.infer<typeof AgentExecutionContextSchema>;
export type AgentExecutionJournalPathType = z.infer<typeof AgentExecutionJournalPathSchema>;
export type AgentExecutionTurnRequestType = z.infer<typeof AgentExecutionTurnRequestSchema>;
export type AgentExecutionConsoleStateType = z.infer<typeof AgentExecutionConsoleStateSchema>;
export type AgentExecutionConsoleEventType = z.infer<typeof AgentExecutionConsoleEventSchema>;
export type AgentExecutionLaunchRequestType = z.infer<typeof AgentExecutionLaunchRequestSchema>;
export type AgentExecutionProcessType = z.infer<typeof AgentExecutionProcessSchema>;
export type AgentExecutionProcess = AgentExecutionProcessType;
export type AgentExecutionStorageType = z.infer<typeof AgentExecutionStorageSchema>;
export type AgentExecutionType = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionCommandAcknowledgementType = z.infer<typeof AgentExecutionCommandAcknowledgementSchema>;
export type AgentExecutionChangedType = z.infer<typeof AgentExecutionChangedSchema>;
export type AgentExecutionEventType = z.infer<typeof AgentExecutionEventSchema>;

export type AgentId = string;
export type AgentExecutionId = string;
export type AgentMetadataValue = string | number | boolean | null;
export type AgentMetadata = Record<string, AgentMetadataValue>;

export type AgentPrompt = AgentExecutionPromptType;
export type AgentCommand = AgentExecutionCommandType;
export type AgentExecutionProgress = AgentExecutionProgressType;
export type AgentExecutionReference = AgentExecutionReferenceType;
export type AgentExecutionTerminalTransport = AgentExecutionTerminalTransportType;

export interface AgentCapabilities {
    acceptsPromptSubmission: boolean;
    acceptsCommands: boolean;
    supportsInterrupt: boolean;
    supportsResumeByReference: boolean;
    supportsCheckpoint: boolean;
    exportFormats?: string[];
    shareModes?: string[];
}

export interface AgentTaskContext {
    taskId: string;
    stageId: string;
    title: string;
    description: string;
    instruction: string;
    acceptanceCriteria?: string[];
}

export interface AgentContextDocument {
    documentId: string;
    kind: 'spec' | 'brief' | 'artifact' | 'note';
    title: string;
    path?: string;
    summary?: string;
}

export interface AgentSpecificationContext {
    summary: string;
    documents: AgentContextDocument[];
}

export type AgentResumePolicy =
    | { mode: 'new' }
    | { mode: 'attach-or-create'; previousAgentExecutionId?: AgentExecutionId }
    | { mode: 'attach-only'; previousAgentExecutionId: AgentExecutionId };

export interface AgentLaunchConfig {
    ownerId: string;
    workingDirectory: string;
    task?: AgentTaskContext;
    specification?: AgentSpecificationContext;
    requestedAdapterId?: AgentId;
    resume: AgentResumePolicy;
    initialPrompt?: AgentPrompt;
    launchEnv?: Record<string, string>;
    metadata?: AgentMetadata;
}

export type AgentExecutionProtocolErrorCode =
    | 'adapter-not-available'
    | 'invalid-launch-config'
    | 'execution-not-found'
    | 'prompt-not-accepted'
    | 'command-not-supported'
    | 'invalid-execution-state'
    | 'launch-failed'
    | 'reconcile-failed';

export interface AgentExecutionProtocolError extends Error {
    readonly code: AgentExecutionProtocolErrorCode;
    readonly agentId?: AgentId;
    readonly agentExecutionId?: AgentExecutionId;
}

export type AgentExecutionEvent =
    | { type: 'execution.started'; execution: AgentExecutionProcessType }
    | { type: 'execution.attached'; execution: AgentExecutionProcessType }
    | { type: 'execution.updated'; execution: AgentExecutionProcessType }
    | {
        type: 'execution.message';
        channel: 'stdout' | 'stderr' | 'system' | 'agent';
        text: string;
        timelineItem?: AgentExecutionTimelineItemType;
        execution: AgentExecutionProcessType;
    }
    | { type: 'execution.completed'; execution: AgentExecutionProcessType }
    | { type: 'execution.failed'; reason: string; execution: AgentExecutionProcessType }
    | { type: 'execution.cancelled'; reason?: string; execution: AgentExecutionProcessType }
    | { type: 'execution.terminated'; reason?: string; execution: AgentExecutionProcessType };

export type AgentExecutionInteractionCapabilities = AgentExecutionInteractionCapabilitiesType;

export type AgentProgressState = AgentProgressStateType;
export type AgentExecutionStatusPhase = AgentStatusSignalPayloadType['phase'];
export type AgentExecutionSignalSource = AgentExecutionJournalSignalSourceType;
export type AgentExecutionSignalConfidence = AgentExecutionJournalSignalConfidenceType;
export type AgentExecutionInputChoice = AgentExecutionJournalInputChoiceType;
export type AgentExecutionDiagnosticCode = Extract<AgentExecutionJournalSignalType, { type: 'diagnostic' }>['code'];
export type AgentExecutionSignal = AgentExecutionJournalSignalType;

export type AgentExecutionObservationAddress = {
    agentExecutionId: AgentExecutionId;
    ownerId: string;
};

export type AgentExecutionObservationOrigin =
    | 'daemon'
    | 'provider-output'
    | 'agent-signal'
    | 'terminal-output';

export type AgentExecutionSignalCandidate = {
    signal: AgentExecutionSignal;
    dedupeKey?: string;
    claimedAddress?: AgentExecutionObservationAddress;
    claimedAgentExecutionId?: AgentExecutionId;
    rawText?: string;
};

export type AgentExecutionObservation = {
    observationId: string;
    observedAt: string;
    signal: AgentExecutionSignal;
    route: {
        origin: AgentExecutionObservationOrigin;
        address: AgentExecutionObservationAddress;
    };
    claimedAddress?: AgentExecutionObservationAddress;
    rawText?: string;
};

export type AgentExecutionSignalDecision =
    | { action: 'reject'; reason: string }
    | { action: 'record-observation-only'; reason: string }
    | { action: 'emit-message'; event: AgentExecutionEvent }
    | {
        action: 'update-execution';
        eventType: 'execution.updated' | 'execution.completed' | 'execution.failed';
        patch: Partial<AgentExecutionProcessType>;
    };

export function cloneObservationAddress(address: AgentExecutionObservationAddress): AgentExecutionObservationAddress {
    return {
        agentExecutionId: address.agentExecutionId,
        ownerId: address.ownerId
    };
}

export function sameObservationAddress(
    left: AgentExecutionObservationAddress,
    right: AgentExecutionObservationAddress
): boolean {
    return left.agentExecutionId === right.agentExecutionId && left.ownerId === right.ownerId;
}

export function cloneSignal(signal: AgentExecutionSignal): AgentExecutionSignal {
    return structuredClone(signal);
}

export function isScalarAgentMetadataValue(value: unknown): value is AgentMetadata[string] {
    return value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

export function deriveAgentExecutionInteractionCapabilities(input: Pick<
    AgentExecutionProcessType,
    'status' | 'transport' | 'acceptsPrompts' | 'acceptedCommands'
>): AgentExecutionInteractionCapabilities {
    const terminalBacked = input.transport?.kind === 'terminal';
    const liveTerminal = terminalBacked && !isTerminalFinalStatus(input.status);
    if (liveTerminal) {
        return {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: input.acceptsPrompts,
            canSendStructuredCommand: input.acceptedCommands.length > 0
        };
    }

    const canSendStructuredPrompt = input.acceptsPrompts;
    const canSendStructuredCommand = input.acceptedCommands.length > 0;
    if (canSendStructuredPrompt || canSendStructuredCommand) {
        return {
            mode: 'agent-message',
            canSendTerminalInput: false,
            canSendStructuredPrompt,
            canSendStructuredCommand
        };
    }

    if (terminalBacked) {
        return {
            mode: 'read-only',
            canSendTerminalInput: false,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false,
            reason: 'The terminal is no longer accepting live input.'
        };
    }

    return {
        mode: 'read-only',
        canSendTerminalInput: false,
        canSendStructuredPrompt: false,
        canSendStructuredCommand: false,
        reason: 'This AgentExecution does not accept operator follow-up input.'
    };
}

export function isTerminalFinalStatus(status: AgentExecutionProcessType['status']): boolean {
    return status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'terminated';
}

export type AgentConnectionTestKind =
    | 'success'
    | 'auth-failed'
    | 'spawn-failed'
    | 'timeout'
    | 'invalid-model'
    | 'unknown';

export type AgentConnectionDiagnostic = {
    kind: AgentConnectionTestKind;
    summary: string;
    detail?: string;
    diagnosticCode?: string;
    sampleOutput?: string;
    metadata?: AgentMetadata;
};