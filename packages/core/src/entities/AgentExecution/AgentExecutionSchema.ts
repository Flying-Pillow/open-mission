import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandInputDescriptorSchema,
    EntityIdSchema,
    EntityPresentationToneSchema
} from '../Entity/EntitySchema.js';

export const agentExecutionEntityName = 'AgentExecution' as const;

export const AgentExecutionTerminalRecordingPathSchema = z.string()
    .trim()
    .min(1)
    .refine((value) => /^terminal-recordings\/[^/]+\.terminal\.jsonl$/u.test(value), {
        message: 'AgentExecution terminal recordings must use terminal-recordings/<agentExecutionId>.terminal.jsonl.'
    });

export const AgentExecutionJournalPathSchema = z.string()
    .trim()
    .min(1)
    .refine((value) => /^agent-journals\/[^/]+\.interaction\.jsonl$/u.test(value), {
        message: 'AgentExecution journals must use agent-journals/<agentExecutionId>.interaction.jsonl.'
    });
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

export type AgentExecutionPrimitiveValue = string | number | boolean | null;

const agentExecutionMetadataSchema = z.record(z.string(), agentExecutionMetadataValueSchema);

export const MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH = 2_000;
export const MAX_AGENT_EXECUTION_MESSAGE_LENGTH = 8_000;
export const MAX_AGENT_EXECUTION_USAGE_ENTRIES = 32;
export const MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES = 6;
export const MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES = 64;
export const MAX_AGENT_DECLARED_SIGNAL_MARKER_LENGTH = 4_096;

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

export const AgentExecutionTerminalHandleSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1),
    sharedTerminalName: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTerminalRouteParamsSchema = z.object({
    agentExecutionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalQuerySchema = z.object({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRouteQuerySchema = z.object({
    ownerId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRouteInputSchema = z.object({
    ownerId: z.string().trim().min(1),
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
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    recording: z.lazy(() => AgentExecutionTerminalRecordingSchema).optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const AgentExecutionTerminalRecordingHeaderEventSchema = z.object({
    type: z.literal('header'),
    version: z.literal(1),
    kind: z.literal('agent-execution-terminal-recording'),
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    terminalName: z.string().trim().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    createdAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRecordingEventSchema = z.discriminatedUnion('type', [
    AgentExecutionTerminalRecordingHeaderEventSchema,
    z.object({
        type: z.literal('output'),
        at: z.string().trim().min(1),
        data: z.string()
    }).strict(),
    z.object({
        type: z.literal('input'),
        at: z.string().trim().min(1),
        data: z.string(),
        literal: z.boolean().optional()
    }).strict(),
    z.object({
        type: z.literal('resize'),
        at: z.string().trim().min(1),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    }).strict(),
    z.object({
        type: z.literal('exit'),
        at: z.string().trim().min(1),
        exitCode: z.number().int().nullable()
    }).strict()
]);

export const AgentExecutionTerminalRecordingSchema = z.object({
    version: z.literal(1),
    events: z.array(AgentExecutionTerminalRecordingEventSchema)
}).strict().refine((value) => value.events[0]?.type === 'header', {
    message: 'Agent execution terminal recording requires a header event.'
});

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
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
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
    icon: z.string().trim().min(1).optional(),
    tone: EntityPresentationToneSchema.optional(),
    delivery: z.enum(['best-effort']),
    mutatesContext: z.boolean(),
    input: EntityCommandInputDescriptorSchema.optional()
}).strict();

export const AgentExecutionScopeSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('system'),
        label: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        kind: z.literal('repository'),
        repositoryRootPath: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('mission'),
        missionId: z.string().trim().min(1),
        repositoryRootPath: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        kind: z.literal('task'),
        missionId: z.string().trim().min(1),
        taskId: z.string().trim().min(1),
        stageId: z.string().trim().min(1).optional(),
        repositoryRootPath: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        kind: z.literal('artifact'),
        artifactId: z.string().trim().min(1),
        repositoryRootPath: z.string().trim().min(1).optional(),
        missionId: z.string().trim().min(1).optional(),
        taskId: z.string().trim().min(1).optional(),
        stageId: z.string().trim().min(1).optional()
    }).strict()
]);

export const AgentExecutionProtocolOwnerEntitySchema = z.enum([
    'System',
    'Repository',
    'Mission',
    'Task',
    'Artifact'
]);

export const AgentExecutionOwnerMarkerPrefixSchema = z.enum([
    '@system::',
    '@repository::',
    '@mission::',
    '@task::',
    '@artifact::'
]);

export const AgentSignalDeliverySchema = z.enum(['stdout-marker', 'mcp-tool']);

export const AgentSignalPolicySchema = z.enum([
    'progress',
    'claim',
    'input-request',
    'audit-message',
    'diagnostic'
]);

export const AgentSignalOutcomeSchema = z.enum([
    'agent-execution-event',
    'agent-execution-state',
    'owner-entity-event',
    'workflow-event'
]);

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

export const AgentSignalArtifactActivitySchema = z.enum([
    'read',
    'edit',
    'write',
    'reference',
    'output'
]);

export const AgentSignalArtifactReferenceSchema = z.object({
    artifactId: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    label: agentSignalBoundedTextSchema.optional(),
    activity: AgentSignalArtifactActivitySchema.optional()
}).strict().refine((value) => Boolean(value.artifactId || value.path), {
    message: 'Agent-declared artifact references require artifactId or path.'
});

const agentSignalArtifactReferencesField = {
    artifacts: z.array(AgentSignalArtifactReferenceSchema).min(1).max(MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES).optional()
} as const;

export const AgentSignalInputChoiceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('fixed'),
        label: agentSignalBoundedTextSchema,
        value: agentSignalBoundedTextSchema
    }).strict(),
    z.object({
        kind: z.literal('manual'),
        label: agentSignalBoundedTextSchema,
        placeholder: agentSignalBoundedTextSchema.optional()
    }).strict()
]);

export const AgentProgressSignalPayloadSchema = z.object({
    type: z.literal('progress'),
    summary: agentSignalBoundedTextSchema,
    detail: agentSignalBoundedTextSchema.optional(),
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentStatusSignalPhaseSchema = z.enum(['initializing', 'idle']);

export const AgentStatusSignalPayloadSchema = z.object({
    type: z.literal('status'),
    phase: AgentStatusSignalPhaseSchema,
    summary: agentSignalBoundedTextSchema.optional(),
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentNeedsInputSignalPayloadSchema = z.object({
    type: z.literal('needs_input'),
    question: agentSignalBoundedTextSchema,
    choices: z.array(AgentSignalInputChoiceSchema).min(1).max(MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES),
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentBlockedSignalPayloadSchema = z.object({
    type: z.literal('blocked'),
    reason: agentSignalBoundedTextSchema,
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentReadyForVerificationSignalPayloadSchema = z.object({
    type: z.literal('ready_for_verification'),
    summary: agentSignalBoundedTextSchema,
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentCompletedClaimSignalPayloadSchema = z.object({
    type: z.literal('completed_claim'),
    summary: agentSignalBoundedTextSchema,
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentFailedClaimSignalPayloadSchema = z.object({
    type: z.literal('failed_claim'),
    reason: agentSignalBoundedTextSchema,
    ...agentSignalArtifactReferencesField
}).strict();

export const AgentMessageSignalPayloadSchema = z.object({
    type: z.literal('message'),
    channel: z.enum(['agent', 'system', 'stdout', 'stderr']),
    text: z.string().trim().min(1).max(MAX_AGENT_EXECUTION_MESSAGE_LENGTH),
    ...agentSignalArtifactReferencesField
}).strict();

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

export const AgentExecutionTimelineZoneSchema = z.enum([
    'conversation',
    'activity',
    'workflow',
    'runtime',
    'artifact'
]);

export const AgentExecutionTimelineSeveritySchema = z.enum([
    'info',
    'success',
    'warning',
    'error',
    'critical'
]);

export const AgentExecutionTimelinePrimitiveSchema = z.enum([
    'conversation.operator-message',
    'conversation.agent-message',
    'conversation.system-message',
    'conversation.reasoning-summary',
    'attention.input-request',
    'attention.blocked',
    'attention.verification-requested',
    'attention.verification-result',
    'activity.status',
    'activity.progress',
    'activity.tool',
    'activity.target',
    'workflow.event',
    'workflow.state-changed',
    'runtime.indicator',
    'runtime.warning',
    'terminal.snippet',
    'artifact.created',
    'artifact.updated',
    'artifact.diff',
    'replay.marker',
    'summary.generated'
]);

export const AgentExecutionRenderBehaviorSchema = z.object({
    class: z.enum([
        'conversational',
        'timeline-event',
        'live-activity',
        'artifact',
        'approval',
        'runtime-warning',
        'terminal',
        'replay-anchor'
    ]),
    compactable: z.boolean(),
    collapsible: z.boolean(),
    sticky: z.boolean(),
    actionable: z.boolean(),
    replayRelevant: z.boolean(),
    transient: z.boolean(),
    defaultExpanded: z.boolean()
}).strict();

export const AgentExecutionTimelineProvenanceSchema = z.object({
    durable: z.boolean(),
    sourceRecordIds: z.array(z.string().trim().min(1)),
    confidence: z.enum(['authoritative', 'high', 'medium', 'low', 'diagnostic']).optional(),
    liveOverlay: z.boolean().optional()
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

export type AgentExecutionTerminalRouteParamsType = z.infer<typeof AgentExecutionTerminalRouteParamsSchema>;
export type AgentExecutionJournalPathType = z.infer<typeof AgentExecutionJournalPathSchema>;
export type AgentExecutionTerminalQueryType = z.infer<typeof AgentExecutionTerminalQuerySchema>;
export type AgentExecutionTerminalRouteInputType = z.infer<typeof AgentExecutionTerminalRouteInputSchema>;
export type AgentExecutionTerminalRecordingHeaderEventType = z.infer<typeof AgentExecutionTerminalRecordingHeaderEventSchema>;
export type AgentExecutionTerminalRecordingEventType = z.infer<typeof AgentExecutionTerminalRecordingEventSchema>;
export type AgentExecutionTerminalRecordingType = z.infer<typeof AgentExecutionTerminalRecordingSchema>;
export type AgentExecutionTerminalSnapshotType = z.infer<typeof AgentExecutionTerminalSnapshotSchema>;
export type AgentExecutionTerminalSocketClientMessageType = z.infer<typeof AgentExecutionTerminalSocketClientMessageSchema>;
export type AgentExecutionTerminalOutputType = z.infer<typeof AgentExecutionTerminalOutputSchema>;
export type AgentExecutionTerminalSocketServerMessageType = z.infer<typeof AgentExecutionTerminalSocketServerMessageSchema>;
export type AgentExecutionContextArtifactRoleType = z.infer<typeof AgentExecutionContextArtifactRoleSchema>;
export type AgentExecutionContextArtifactType = z.infer<typeof AgentExecutionContextArtifactSchema>;
export type AgentExecutionContextInstructionType = z.infer<typeof AgentExecutionContextInstructionSchema>;
export type AgentExecutionContextType = z.infer<typeof AgentExecutionContextSchema>;
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
export type AgentSignalPayloadType = z.infer<typeof AgentSignalPayloadSchema>;
export type AgentSignalMarkerPayloadType = z.infer<typeof AgentSignalMarkerPayloadSchema>;
export type AgentExecutionObservationAckType = z.infer<typeof AgentExecutionObservationAckSchema>;
export type AgentExecutionTimelineZoneType = z.infer<typeof AgentExecutionTimelineZoneSchema>;
export type AgentExecutionTimelineSeverityType = z.infer<typeof AgentExecutionTimelineSeveritySchema>;
export type AgentExecutionTimelinePrimitiveType = z.infer<typeof AgentExecutionTimelinePrimitiveSchema>;
export type AgentExecutionRenderBehaviorType = z.infer<typeof AgentExecutionRenderBehaviorSchema>;
export type AgentExecutionTimelineProvenanceType = z.infer<typeof AgentExecutionTimelineProvenanceSchema>;
export type AgentExecutionTimelinePayloadType = z.infer<typeof AgentExecutionTimelinePayloadSchema>;
export type AgentExecutionTimelineItemType = z.infer<typeof AgentExecutionTimelineItemSchema>;
export type AgentExecutionActivityProjectionType = z.infer<typeof AgentExecutionActivityProjectionSchema>;
export type AgentExecutionAttentionProjectionType = z.infer<typeof AgentExecutionAttentionProjectionSchema>;
export type AgentExecutionRuntimeOverlayProjectionType = z.infer<typeof AgentExecutionRuntimeOverlayProjectionSchema>;
export type AgentExecutionProjectionType = z.infer<typeof AgentExecutionProjectionSchema>;
export type AgentExecutionProtocolOwnerType = z.infer<typeof AgentExecutionProtocolOwnerSchema>;
export type AgentExecutionProtocolMcpType = z.infer<typeof AgentExecutionProtocolMcpSchema>;
export type AgentExecutionProtocolDescriptorType = z.infer<typeof AgentExecutionProtocolDescriptorSchema>;
export type AgentExecutionTransportStateType = z.infer<typeof AgentExecutionTransportStateSchema>;
export type AgentExecutionRuntimeCommandType = z.infer<typeof AgentExecutionRuntimeCommandTypeSchema>;

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

export const AgentExecutionSemanticActivitySchema = z.enum([
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

export type AgentExecutionLifecycleStateType = z.infer<typeof AgentExecutionLifecycleStateSchema>;
export type AgentExecutionAttentionStateType = z.infer<typeof AgentExecutionAttentionStateSchema>;
export type AgentExecutionSemanticActivityType = z.infer<typeof AgentExecutionSemanticActivitySchema>;
export type AgentExecutionInteractionModeType = z.infer<typeof AgentExecutionInteractionModeSchema>;
export type AgentExecutionInteractionCapabilitiesType = z.infer<typeof AgentExecutionInteractionCapabilitiesSchema>;

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
    activity: AgentExecutionSemanticActivitySchema.optional(),
    progress: AgentExecutionActivityProgressSchema.optional(),
    capabilities: AgentExecutionCapabilitySnapshotSchema.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionTimelinePayloadSchema = z.object({
    title: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    markdown: z.boolean().optional(),
    choices: z.array(AgentSignalInputChoiceSchema).optional(),
    summary: z.string().trim().min(1).optional(),
    units: AgentExecutionActivityProgressSchema.shape.units.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional(),
    activeToolName: z.string().trim().min(1).optional(),
    entity: z.enum(['System', 'Repository', 'Mission', 'Task', 'Artifact']).optional(),
    entityEventId: z.string().trim().min(1).optional(),
    workflowEventId: z.string().trim().min(1).optional(),
    result: z.enum(['requested', 'accepted', 'rejected', 'passed', 'failed']).optional(),
    transport: z.enum(['stdout-marker', 'mcp-tool', 'pty-terminal', 'adapter', 'none']).optional(),
    connected: z.boolean().optional(),
    terminalAttached: z.boolean().optional(),
    diagnosticCode: z.string().trim().min(1).optional(),
    artifactId: z.string().trim().min(1).optional(),
    artifacts: z.array(AgentSignalArtifactReferenceSchema).optional(),
    path: z.string().trim().min(1).optional(),
    mediaType: z.string().trim().min(1).optional(),
    diffRef: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTimelineItemSchema = z.object({
    id: z.string().trim().min(1),
    occurredAt: z.string().trim().min(1),
    zone: AgentExecutionTimelineZoneSchema,
    primitive: AgentExecutionTimelinePrimitiveSchema,
    behavior: AgentExecutionRenderBehaviorSchema,
    severity: AgentExecutionTimelineSeveritySchema.optional(),
    provenance: AgentExecutionTimelineProvenanceSchema,
    payload: AgentExecutionTimelinePayloadSchema
}).strict();

export const AgentExecutionActivityProjectionSchema = z.object({
    lifecycleState: AgentExecutionLifecycleStateSchema.optional(),
    attention: AgentExecutionAttentionStateSchema.optional(),
    activity: AgentExecutionSemanticActivitySchema.optional(),
    summary: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    units: AgentExecutionActivityProgressSchema.shape.units.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional(),
    activeToolName: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionAttentionProjectionSchema = z.object({
    state: AgentExecutionAttentionStateSchema,
    primitive: z.enum([
        'attention.input-request',
        'attention.blocked',
        'attention.verification-requested',
        'attention.verification-result'
    ]),
    severity: AgentExecutionTimelineSeveritySchema.optional(),
    title: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    choices: z.array(AgentSignalInputChoiceSchema).optional(),
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionRuntimeOverlayProjectionSchema = z.object({
    items: z.array(AgentExecutionTimelineItemSchema)
}).strict();

export const AgentExecutionProjectionSchema = z.object({
    timelineItems: z.array(AgentExecutionTimelineItemSchema),
    currentActivity: AgentExecutionActivityProjectionSchema.optional(),
    currentAttention: AgentExecutionAttentionProjectionSchema.optional(),
    runtimeOverlay: AgentExecutionRuntimeOverlayProjectionSchema.optional()
}).strict();

export type AgentExecutionModelInfo = z.infer<typeof AgentExecutionModelInfoSchema>;
export type AgentExecutionTelemetrySnapshot = z.infer<typeof AgentExecutionTelemetrySnapshotSchema>;
export type AgentExecutionActivityProgressType = z.infer<typeof AgentExecutionActivityProgressSchema>;
export type AgentExecutionCapabilitySnapshotType = z.infer<typeof AgentExecutionCapabilitySnapshotSchema>;
export type AgentExecutionActivityTargetType = z.infer<typeof AgentExecutionActivityTargetSchema>;
export type AgentExecutionRuntimeActivitySnapshotType = z.infer<typeof AgentExecutionRuntimeActivitySnapshotSchema>;

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
    semanticActivity?: AgentExecutionSemanticActivityType;
    currentInputRequestId?: string | null;
    awaitingResponseToMessageId?: string | null;
    workingDirectory?: string;
    currentTurnTitle?: string;
    interactionCapabilities: AgentExecutionInteractionCapabilitiesType;
    runtimeMessages: AgentExecutionMessageDescriptorType[];
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    scope?: AgentExecutionScopeType;
    runtimeActivity?: AgentExecutionRuntimeActivitySnapshotType;
    awaitingPermission?: AgentExecutionPermissionRequest;
    telemetry?: AgentExecutionTelemetrySnapshot;
    failureMessage?: string;
    lastUpdatedAt: string;
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
    semanticActivity?: AgentExecutionSemanticActivityType;
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
    runtimeActivity?: AgentExecutionRuntimeActivitySnapshotType;
    telemetry?: AgentExecutionTelemetrySnapshot;
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

export const AgentExecutionStorageSchema = z.object({
    id: EntityIdSchema,
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
    semanticActivity: AgentExecutionSemanticActivitySchema.optional(),
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
    runtimeActivity: AgentExecutionRuntimeActivitySnapshotSchema.optional(),
    telemetry: AgentExecutionTelemetrySnapshotSchema.optional(),
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
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
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
