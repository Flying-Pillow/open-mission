import { z } from 'zod/v4';
import {
    EntityCommandInputDescriptorSchema,
    EntityPresentationToneSchema
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

const agentExecutionMetadataSchema = z.record(z.string(), agentExecutionMetadataValueSchema);

export const MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH = 2_000;
export const MAX_AGENT_EXECUTION_MESSAGE_LENGTH = 8_000;
export const MAX_AGENT_EXECUTION_USAGE_ENTRIES = 32;
export const MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES = 6;
export const MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES = 64;
export const MAX_AGENT_SIGNAL_MARKER_LENGTH = 4_096;

export const AgentExecutionPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentExecutionMetadataSchema.optional()
}).strict();

export const AgentExecutionReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);

export const AgentExecutionLaunchModeSchema = z.enum(['interactive', 'autonomous']);

export const AgentExecutionCommandSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('interrupt'), reason: z.string().trim().min(1).optional(), metadata: agentExecutionMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal('checkpoint'), reason: z.string().trim().min(1).optional(), metadata: agentExecutionMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal('nudge'), reason: z.string().trim().min(1).optional(), metadata: agentExecutionMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal('resume'), reason: z.string().trim().min(1).optional(), metadata: agentExecutionMetadataSchema.optional() }).strict()
]);

export const AgentExecutionInteractionModeSchema = z.enum(['pty-terminal', 'agent-message', 'read-only']);

export const AgentExecutionInteractionCapabilitiesSchema = z.object({
    mode: AgentExecutionInteractionModeSchema,
    canSendTerminalInput: z.boolean(),
    canSendStructuredPrompt: z.boolean(),
    canSendStructuredCommand: z.boolean(),
    reason: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionLocatorSchema = z.object({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1)
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
}).refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'AgentExecution terminal input requires data or a complete cols/rows resize payload.'
});

export const AgentExecutionContextArtifactRoleSchema = z.enum(['instruction', 'reference', 'evidence', 'output']);

export const AgentExecutionMessageDescriptorSchema = z.object({
    type: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    icon: z.string().trim().min(1).optional(),
    tone: EntityPresentationToneSchema.optional(),
    delivery: z.enum(['best-effort']),
    mutatesContext: z.boolean(),
    input: EntityCommandInputDescriptorSchema.optional()
}).strict();

export const AgentExecutionScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('system'), label: z.string().trim().min(1).optional() }).strict(),
    z.object({ kind: z.literal('repository'), repositoryRootPath: z.string().trim().min(1) }).strict(),
    z.object({ kind: z.literal('mission'), missionId: z.string().trim().min(1), repositoryRootPath: z.string().trim().min(1).optional() }).strict(),
    z.object({ kind: z.literal('task'), missionId: z.string().trim().min(1), taskId: z.string().trim().min(1), stageId: z.string().trim().min(1).optional(), repositoryRootPath: z.string().trim().min(1).optional() }).strict(),
    z.object({ kind: z.literal('artifact'), artifactId: z.string().trim().min(1), repositoryRootPath: z.string().trim().min(1).optional(), missionId: z.string().trim().min(1).optional(), taskId: z.string().trim().min(1).optional(), stageId: z.string().trim().min(1).optional() }).strict()
]);

export const AgentExecutionProtocolOwnerEntitySchema = z.enum(['System', 'Repository', 'Mission', 'Task', 'Artifact']);
export const AgentExecutionOwnerMarkerPrefixSchema = z.enum(['@system::', '@repository::', '@mission::', '@task::', '@artifact::']);
export const AgentSignalDeliverySchema = z.enum(['stdout-marker', 'mcp-tool']);
export const AgentSignalPolicySchema = z.enum(['progress', 'claim', 'input-request', 'audit-message', 'diagnostic']);
export const AgentSignalOutcomeSchema = z.enum(['agent-execution-event', 'agent-execution-state', 'owner-entity-event', 'workflow-event']);

export const AgentSignalDescriptorSchema = z.object({
    type: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    icon: z.string().trim().min(1),
    tone: EntityPresentationToneSchema,
    payloadSchemaKey: z.string().trim().min(1),
    deliveries: z.array(AgentSignalDeliverySchema).min(1),
    policy: AgentSignalPolicySchema,
    outcomes: z.array(AgentSignalOutcomeSchema).min(1)
}).strict();

const agentSignalBoundedTextSchema = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH);

export const AgentSignalArtifactActivitySchema = z.enum(['read', 'edit', 'write', 'reference', 'output']);

export const AgentSignalArtifactReferenceSchema = z.object({
    artifactId: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    label: agentSignalBoundedTextSchema.optional(),
    activity: AgentSignalArtifactActivitySchema.optional()
}).strict().refine((value) => Boolean(value.artifactId || value.path), {
    message: 'Agent signal artifact references require artifactId or path.'
});

const agentSignalArtifactReferencesField = {
    artifacts: z.array(AgentSignalArtifactReferenceSchema).min(1).max(MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES).optional()
} as const;

export const AgentSignalInputChoiceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixed'), label: agentSignalBoundedTextSchema, value: agentSignalBoundedTextSchema }).strict(),
    z.object({ kind: z.literal('manual'), label: agentSignalBoundedTextSchema, placeholder: agentSignalBoundedTextSchema.optional() }).strict()
]);

export const AgentProgressSignalPayloadSchema = z.object({ type: z.literal('progress'), summary: agentSignalBoundedTextSchema, detail: agentSignalBoundedTextSchema.optional(), ...agentSignalArtifactReferencesField }).strict();
export const AgentStatusSignalPhaseSchema = z.enum(['initializing', 'idle']);
export const AgentStatusSignalPayloadSchema = z.object({ type: z.literal('status'), phase: AgentStatusSignalPhaseSchema, summary: agentSignalBoundedTextSchema.optional(), ...agentSignalArtifactReferencesField }).strict();
export const AgentNeedsInputSignalPayloadSchema = z.object({ type: z.literal('needs_input'), question: agentSignalBoundedTextSchema, choices: z.array(AgentSignalInputChoiceSchema).min(1).max(MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES), ...agentSignalArtifactReferencesField }).strict();
export const AgentBlockedSignalPayloadSchema = z.object({ type: z.literal('blocked'), reason: agentSignalBoundedTextSchema, ...agentSignalArtifactReferencesField }).strict();
export const AgentReadyForVerificationSignalPayloadSchema = z.object({ type: z.literal('ready_for_verification'), summary: agentSignalBoundedTextSchema, ...agentSignalArtifactReferencesField }).strict();
export const AgentCompletedClaimSignalPayloadSchema = z.object({ type: z.literal('completed_claim'), summary: agentSignalBoundedTextSchema, ...agentSignalArtifactReferencesField }).strict();
export const AgentFailedClaimSignalPayloadSchema = z.object({ type: z.literal('failed_claim'), reason: agentSignalBoundedTextSchema, ...agentSignalArtifactReferencesField }).strict();
export const AgentMessageSignalPayloadSchema = z.object({ type: z.literal('message'), channel: z.enum(['agent', 'system', 'stdout', 'stderr']), text: z.string().trim().min(1).max(MAX_AGENT_EXECUTION_MESSAGE_LENGTH), ...agentSignalArtifactReferencesField }).strict();

export const AgentSignalPayloadSchema = z.discriminatedUnion('type', [
    AgentProgressSignalPayloadSchema,
    AgentStatusSignalPayloadSchema,
    AgentNeedsInputSignalPayloadSchema,
    AgentBlockedSignalPayloadSchema,
    AgentReadyForVerificationSignalPayloadSchema,
    AgentCompletedClaimSignalPayloadSchema,
    AgentFailedClaimSignalPayloadSchema,
    AgentMessageSignalPayloadSchema
]);

export const AgentSignalToolPayloadSchemasByType = {
    progress: AgentProgressSignalPayloadSchema.omit({ type: true }),
    status: AgentStatusSignalPayloadSchema.omit({ type: true }),
    needs_input: AgentNeedsInputSignalPayloadSchema.omit({ type: true }),
    blocked: AgentBlockedSignalPayloadSchema.omit({ type: true }),
    ready_for_verification: AgentReadyForVerificationSignalPayloadSchema.omit({ type: true }),
    completed_claim: AgentCompletedClaimSignalPayloadSchema.omit({ type: true }),
    failed_claim: AgentFailedClaimSignalPayloadSchema.omit({ type: true }),
    message: AgentMessageSignalPayloadSchema.omit({ type: true })
} as const;

export const AgentSignalMarkerPayloadSchema = z.object({
    version: z.literal(1),
    agentExecutionId: agentSignalBoundedTextSchema,
    eventId: agentSignalBoundedTextSchema,
    signal: AgentSignalPayloadSchema
}).strict();

export const AgentExecutionObservationAckSchema = z.object({
    status: z.enum(['accepted', 'duplicate', 'rejected', 'recorded-only', 'promoted']),
    agentExecutionId: z.string().trim().min(1),
    eventId: z.string().trim().min(1),
    observationId: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionProtocolOwnerSchema = z.object({
    entity: AgentExecutionProtocolOwnerEntitySchema,
    entityId: z.string().trim().min(1),
    markerPrefix: AgentExecutionOwnerMarkerPrefixSchema
}).strict();

export const AgentExecutionProtocolMcpSchema = z.object({
    serverName: z.literal('mission-mcp'),
    exposure: z.literal('agent-execution-scoped'),
    publicApi: z.literal(false)
}).strict();

export const AgentExecutionProtocolDescriptorSchema = z.object({
    version: z.literal(1),
    owner: AgentExecutionProtocolOwnerSchema,
    scope: AgentExecutionScopeSchema,
    messages: z.array(AgentExecutionMessageDescriptorSchema),
    signals: z.array(AgentSignalDescriptorSchema),
    mcp: AgentExecutionProtocolMcpSchema.optional()
}).strict();

export type AgentExecutionCommandIdType = z.infer<typeof AgentExecutionCommandIdSchema>;
export type AgentExecutionReasoningEffortType = z.infer<typeof AgentExecutionReasoningEffortSchema>;
export type AgentExecutionLaunchModeType = z.infer<typeof AgentExecutionLaunchModeSchema>;
export type AgentExecutionCommandInputType = z.infer<typeof AgentExecutionCommandInputSchema>;
export type AgentExecutionSendTerminalInputType = z.infer<typeof AgentExecutionSendTerminalInputSchema>;
export type AgentExecutionPromptType = z.infer<typeof AgentExecutionPromptSchema>;
export type AgentExecutionCommandType = z.infer<typeof AgentExecutionCommandSchema>;
export type AgentExecutionInteractionModeType = z.infer<typeof AgentExecutionInteractionModeSchema>;
export type AgentExecutionInteractionCapabilitiesType = z.infer<typeof AgentExecutionInteractionCapabilitiesSchema>;
export type AgentExecutionLocatorType = z.infer<typeof AgentExecutionLocatorSchema>;
export type AgentExecutionEventSubjectType = z.infer<typeof AgentExecutionEventSubjectSchema>;
export type AgentExecutionMessageDescriptorType = z.infer<typeof AgentExecutionMessageDescriptorSchema>;
export type AgentExecutionScopeType = z.infer<typeof AgentExecutionScopeSchema>;
export type AgentExecutionProtocolOwnerEntityType = z.infer<typeof AgentExecutionProtocolOwnerEntitySchema>;
export type AgentExecutionOwnerMarkerPrefixType = z.infer<typeof AgentExecutionOwnerMarkerPrefixSchema>;
export type AgentSignalDeliveryType = z.infer<typeof AgentSignalDeliverySchema>;
export type AgentSignalPolicyType = z.infer<typeof AgentSignalPolicySchema>;
export type AgentSignalOutcomeType = z.infer<typeof AgentSignalOutcomeSchema>;
export type AgentSignalDescriptorType = z.infer<typeof AgentSignalDescriptorSchema>;
export type AgentSignalArtifactActivityType = z.infer<typeof AgentSignalArtifactActivitySchema>;
export type AgentSignalArtifactReferenceType = z.infer<typeof AgentSignalArtifactReferenceSchema>;
export type AgentSignalInputChoiceType = z.infer<typeof AgentSignalInputChoiceSchema>;
export type AgentProgressSignalPayloadType = z.infer<typeof AgentProgressSignalPayloadSchema>;
export type AgentStatusSignalPayloadType = z.infer<typeof AgentStatusSignalPayloadSchema>;
export type AgentNeedsInputSignalPayloadType = z.infer<typeof AgentNeedsInputSignalPayloadSchema>;
export type AgentBlockedSignalPayloadType = z.infer<typeof AgentBlockedSignalPayloadSchema>;
export type AgentReadyForVerificationSignalPayloadType = z.infer<typeof AgentReadyForVerificationSignalPayloadSchema>;
export type AgentCompletedClaimSignalPayloadType = z.infer<typeof AgentCompletedClaimSignalPayloadSchema>;
export type AgentFailedClaimSignalPayloadType = z.infer<typeof AgentFailedClaimSignalPayloadSchema>;
export type AgentMessageSignalPayloadType = z.infer<typeof AgentMessageSignalPayloadSchema>;
export type AgentSignalPayloadType = z.infer<typeof AgentSignalPayloadSchema>;
export type AgentSignalMarkerPayloadType = z.infer<typeof AgentSignalMarkerPayloadSchema>;
export type AgentExecutionObservationAckType = z.infer<typeof AgentExecutionObservationAckSchema>;
export type AgentExecutionProtocolOwnerType = z.infer<typeof AgentExecutionProtocolOwnerSchema>;
export type AgentExecutionProtocolMcpType = z.infer<typeof AgentExecutionProtocolMcpSchema>;
export type AgentExecutionProtocolDescriptorType = z.infer<typeof AgentExecutionProtocolDescriptorSchema>;