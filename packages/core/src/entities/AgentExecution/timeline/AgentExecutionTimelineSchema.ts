import { z } from 'zod/v4';
import {
    AgentSignalArtifactReferenceSchema,
    AgentSignalInputChoiceSchema
} from '../protocol/AgentExecutionProtocolSchema.js';
import {
    AgentExecutionActivityProgressSchema,
    AgentExecutionActivityStateSchema,
    AgentExecutionActivityTargetSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionLifecycleStateSchema
} from '../AgentExecutionStateSchema.js';

export const AgentExecutionTimelineZoneSchema = z.enum(['conversation', 'activity', 'workflow', 'runtime', 'artifact']);
export const AgentExecutionTimelineSeveritySchema = z.enum(['info', 'success', 'warning', 'error', 'critical']);
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
    class: z.enum(['conversational', 'timeline-event', 'live-activity', 'artifact', 'approval', 'runtime-warning', 'terminal', 'replay-anchor']),
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

export const AgentExecutionTimelineActivitySchema = z.object({
    lifecycleState: AgentExecutionLifecycleStateSchema.optional(),
    attention: AgentExecutionAttentionStateSchema.optional(),
    activity: AgentExecutionActivityStateSchema.optional(),
    summary: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    units: AgentExecutionActivityProgressSchema.shape.units.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional(),
    activeToolName: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionTimelineAttentionSchema = z.object({
    state: AgentExecutionAttentionStateSchema,
    primitive: z.enum(['attention.input-request', 'attention.blocked', 'attention.verification-requested', 'attention.verification-result']),
    severity: AgentExecutionTimelineSeveritySchema.optional(),
    title: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    choices: z.array(AgentSignalInputChoiceSchema).optional(),
    currentInputRequestId: z.string().trim().min(1).nullable().optional(),
    updatedAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionLiveTimelineOverlaySchema = z.object({ items: z.array(AgentExecutionTimelineItemSchema) }).strict();
export const AgentExecutionTimelineSchema = z.object({
    timelineItems: z.array(AgentExecutionTimelineItemSchema),
    currentActivity: AgentExecutionTimelineActivitySchema.optional(),
    currentAttention: AgentExecutionTimelineAttentionSchema.optional(),
    liveOverlay: AgentExecutionLiveTimelineOverlaySchema.optional()
}).strict();

export type AgentExecutionTimelineZoneType = z.infer<typeof AgentExecutionTimelineZoneSchema>;
export type AgentExecutionTimelineSeverityType = z.infer<typeof AgentExecutionTimelineSeveritySchema>;
export type AgentExecutionTimelinePrimitiveType = z.infer<typeof AgentExecutionTimelinePrimitiveSchema>;
export type AgentExecutionRenderBehaviorType = z.infer<typeof AgentExecutionRenderBehaviorSchema>;
export type AgentExecutionTimelineProvenanceType = z.infer<typeof AgentExecutionTimelineProvenanceSchema>;
export type AgentExecutionTimelinePayloadType = z.infer<typeof AgentExecutionTimelinePayloadSchema>;
export type AgentExecutionTimelineItemType = z.infer<typeof AgentExecutionTimelineItemSchema>;
export type AgentExecutionTimelineActivityType = z.infer<typeof AgentExecutionTimelineActivitySchema>;
export type AgentExecutionTimelineAttentionType = z.infer<typeof AgentExecutionTimelineAttentionSchema>;
export type AgentExecutionLiveTimelineOverlayType = z.infer<typeof AgentExecutionLiveTimelineOverlaySchema>;
export type AgentExecutionTimelineType = z.infer<typeof AgentExecutionTimelineSchema>;