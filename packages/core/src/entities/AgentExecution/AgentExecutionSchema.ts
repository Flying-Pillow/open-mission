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
    AgentExecutionScopeSchema
} from './protocol/AgentExecutionProtocolSchema.js';
import {
    AgentExecutionActivityStateSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionLifecycleStateSchema,
    AgentExecutionProgressSchema,
    AgentExecutionPermissionRequestSchema,
    AgentExecutionSupportedCommandTypeSchema,
    AgentExecutionLiveActivitySchema,
    AgentExecutionTelemetrySchema,
    AgentExecutionTransportStateSchema
} from './AgentExecutionStateSchema.js';
import { AgentExecutionTimelineSchema } from './timeline/AgentExecutionTimelineSchema.js';
import {
    AgentExecutionReferenceSchema,
    AgentExecutionTerminalTransportSchema,
    AgentExecutionTerminalHandleSchema,
    AgentExecutionTerminalRecordingPathSchema
} from './transport/AgentExecutionTerminalSchema.js';

export * from './transport/AgentExecutionTerminalSchema.js';
export * from './AgentExecutionStateSchema.js';
export * from './protocol/AgentExecutionProtocolSchema.js';
export * from './protocol/AgentExecutionSemanticOperationSchema.js';
export * from './timeline/AgentExecutionTimelineSchema.js';

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
    workingDirectory: z.string().trim().min(1),
    prompt: z.string(),
    scope: AgentExecutionScopeSchema.optional(),
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
    scope: AgentExecutionScopeSchema,
    workingDirectory: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    missionId: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
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
    scope: AgentExecutionScopeSchema.optional(),
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
    taskId: z.string().trim().min(1).optional(),
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
export type AgentExecutionStorageType = z.infer<typeof AgentExecutionStorageSchema>;
export type AgentExecutionType = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionCommandAcknowledgementType = z.infer<typeof AgentExecutionCommandAcknowledgementSchema>;
export type AgentExecutionChangedType = z.infer<typeof AgentExecutionChangedSchema>;
export type AgentExecutionEventType = z.infer<typeof AgentExecutionEventSchema>;