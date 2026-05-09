import { z } from 'zod/v4';
import {
    AgentExecutionActivityProgressSchema,
    AgentExecutionActivityTargetSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionCapabilitySnapshotSchema,
    AgentExecutionLifecycleStateSchema,
    AgentExecutionProtocolDescriptorSchema,
    AgentExecutionProtocolOwnerEntitySchema,
    AgentExecutionSemanticActivitySchema,
    AgentExecutionScopeSchema,
    AgentExecutionTransportStateSchema
} from './AgentExecutionSchema.js';
import {
    AgentExecutionJournalSignalSchema
} from './AgentExecutionSignalRegistry.js';
export type {
    AgentExecutionJournalInputChoiceType,
    AgentExecutionJournalSignalConfidenceType,
    AgentExecutionJournalSignalSourceType,
    AgentExecutionJournalSignalType
} from './AgentExecutionSignalRegistry.js';

const journalTextSchema = z.string().trim().min(1);
const journalPayloadSchema = z.record(z.string(), z.unknown());

export const AgentExecutionJournalSchemaVersionSchema = z.literal(1);

export const AgentExecutionJournalRecordTypeSchema = z.enum([
    'journal.header',
    'message.accepted',
    'message.delivery',
    'observation.recorded',
    'decision.recorded',
    'state.changed',
    'activity.updated',
    'owner-effect.recorded',
    'projection.recorded'
]);

export const AgentExecutionJournalRecordBaseSchema = z.object({
    recordId: journalTextSchema,
    sequence: z.number().int().nonnegative(),
    type: AgentExecutionJournalRecordTypeSchema,
    schemaVersion: AgentExecutionJournalSchemaVersionSchema,
    agentExecutionId: journalTextSchema,
    ownerId: journalTextSchema,
    scope: AgentExecutionScopeSchema,
    occurredAt: journalTextSchema
}).strict();

export const AgentExecutionJournalKindSchema = z.literal('agent-execution-interaction-journal');

export const AgentExecutionJournalHeaderRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('journal.header'),
    kind: AgentExecutionJournalKindSchema,
    agentId: journalTextSchema,
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema,
    transportState: AgentExecutionTransportStateSchema.optional(),
    workingDirectory: journalTextSchema.optional()
}).strict();

export const AgentExecutionMessageSourceSchema = z.enum(['operator', 'daemon', 'system', 'owner']);

export const AgentExecutionMessageAcceptedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('message.accepted'),
    messageId: journalTextSchema,
    source: AgentExecutionMessageSourceSchema,
    messageType: journalTextSchema,
    payload: z.unknown(),
    mutatesContext: z.boolean()
}).strict();

export const AgentExecutionMessageDeliveryTransportSchema = z.enum([
    'agent-message',
    'pty-terminal',
    'adapter',
    'none'
]);

export const AgentExecutionMessageDeliveryStatusSchema = z.enum([
    'attempted',
    'delivered',
    'failed',
    'skipped'
]);

export const AgentExecutionMessageDeliveryRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('message.delivery'),
    messageId: journalTextSchema,
    status: AgentExecutionMessageDeliveryStatusSchema,
    transport: AgentExecutionMessageDeliveryTransportSchema,
    reason: journalTextSchema.optional()
}).strict();

export const AgentExecutionObservationSourceSchema = z.enum([
    'pty',
    'mcp',
    'sdk',
    'provider-output',
    'terminal-heuristic',
    'filesystem',
    'git',
    'daemon'
]);

export const AgentExecutionObservationConfidenceSchema = z.enum([
    'authoritative',
    'high',
    'medium',
    'low',
    'diagnostic'
]);

export const AgentExecutionObservationRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('observation.recorded'),
    observationId: journalTextSchema,
    source: AgentExecutionObservationSourceSchema,
    confidence: AgentExecutionObservationConfidenceSchema,
    signal: AgentExecutionJournalSignalSchema.optional(),
    rawText: z.string().optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionDecisionActionSchema = z.enum([
    'reject',
    'record-only',
    'emit-message',
    'update-state',
    'route-owner-effect'
]);

export const AgentExecutionDecisionRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('decision.recorded'),
    decisionId: journalTextSchema,
    observationId: journalTextSchema.optional(),
    messageId: journalTextSchema.optional(),
    action: AgentExecutionDecisionActionSchema,
    reason: journalTextSchema.optional()
}).strict();

export const AgentExecutionStateChangedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('state.changed'),
    lifecycle: AgentExecutionLifecycleStateSchema.optional(),
    attention: AgentExecutionAttentionStateSchema.optional(),
    activity: AgentExecutionSemanticActivitySchema.optional(),
    currentInputRequestId: journalTextSchema.nullable().optional()
}).strict();

export const AgentExecutionActivityUpdatedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('activity.updated'),
    activity: AgentExecutionSemanticActivitySchema.optional(),
    progress: AgentExecutionActivityProgressSchema.optional(),
    telemetry: z.object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        activeToolName: z.string().trim().min(1).optional()
    }).strict().optional(),
    capabilities: AgentExecutionCapabilitySnapshotSchema.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional()
}).strict();

export const AgentExecutionOwnerEffectRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('owner-effect.recorded'),
    effectId: journalTextSchema,
    observationId: journalTextSchema.optional(),
    ownerEntity: z.enum(['System', 'Repository', 'Mission', 'Task', 'Artifact']),
    effectType: journalTextSchema,
    workflowEventId: journalTextSchema.optional(),
    entityEventId: journalTextSchema.optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionProjectionRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('projection.recorded'),
    projection: z.enum(['chat-message', 'timeline-item']),
    payload: journalPayloadSchema
}).strict();

export const AgentExecutionJournalRecordSchema = z.discriminatedUnion('type', [
    AgentExecutionJournalHeaderRecordSchema,
    AgentExecutionMessageAcceptedRecordSchema,
    AgentExecutionMessageDeliveryRecordSchema,
    AgentExecutionObservationRecordSchema,
    AgentExecutionDecisionRecordSchema,
    AgentExecutionStateChangedRecordSchema,
    AgentExecutionActivityUpdatedRecordSchema,
    AgentExecutionOwnerEffectRecordSchema,
    AgentExecutionProjectionRecordSchema
]);

export const AgentExecutionJournalReferenceSchema = z.object({
    journalId: z.string().trim().min(1),
    ownerEntity: AgentExecutionProtocolOwnerEntitySchema,
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    recordCount: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative()
}).strict();

export type AgentExecutionJournalSchemaVersionType = z.infer<typeof AgentExecutionJournalSchemaVersionSchema>;
export type AgentExecutionJournalRecordTypeType = z.infer<typeof AgentExecutionJournalRecordTypeSchema>;
export type AgentExecutionJournalRecordBaseType = z.infer<typeof AgentExecutionJournalRecordBaseSchema>;
export type AgentExecutionJournalKindType = z.infer<typeof AgentExecutionJournalKindSchema>;
export type AgentExecutionJournalHeaderRecordType = z.infer<typeof AgentExecutionJournalHeaderRecordSchema>;
export type AgentExecutionMessageSourceType = z.infer<typeof AgentExecutionMessageSourceSchema>;
export type AgentExecutionMessageAcceptedRecordType = z.infer<typeof AgentExecutionMessageAcceptedRecordSchema>;
export type AgentExecutionMessageDeliveryTransportType = z.infer<typeof AgentExecutionMessageDeliveryTransportSchema>;
export type AgentExecutionMessageDeliveryStatusType = z.infer<typeof AgentExecutionMessageDeliveryStatusSchema>;
export type AgentExecutionMessageDeliveryRecordType = z.infer<typeof AgentExecutionMessageDeliveryRecordSchema>;
export type AgentExecutionObservationSourceType = z.infer<typeof AgentExecutionObservationSourceSchema>;
export type AgentExecutionObservationConfidenceType = z.infer<typeof AgentExecutionObservationConfidenceSchema>;
export type AgentExecutionObservationRecordType = z.infer<typeof AgentExecutionObservationRecordSchema>;
export type AgentExecutionDecisionActionType = z.infer<typeof AgentExecutionDecisionActionSchema>;
export type AgentExecutionDecisionRecordType = z.infer<typeof AgentExecutionDecisionRecordSchema>;
export type AgentExecutionAttentionStateType = z.infer<typeof AgentExecutionAttentionStateSchema>;
export type AgentExecutionSemanticActivityType = z.infer<typeof AgentExecutionSemanticActivitySchema>;
export type AgentExecutionStateChangedRecordType = z.infer<typeof AgentExecutionStateChangedRecordSchema>;
export type AgentExecutionActivityUpdatedRecordType = z.infer<typeof AgentExecutionActivityUpdatedRecordSchema>;
export type AgentExecutionOwnerEffectRecordType = z.infer<typeof AgentExecutionOwnerEffectRecordSchema>;
export type AgentExecutionProjectionRecordType = z.infer<typeof AgentExecutionProjectionRecordSchema>;
export type AgentExecutionJournalRecordType = z.infer<typeof AgentExecutionJournalRecordSchema>;
export type AgentExecutionJournalReferenceType = z.infer<typeof AgentExecutionJournalReferenceSchema>;

export type AgentExecutionJournalStore = {
    ensureJournal(reference: AgentExecutionJournalReferenceType): Promise<void>;
    appendRecord(
        reference: AgentExecutionJournalReferenceType,
        record: AgentExecutionJournalRecordType
    ): Promise<void>;
    readRecords(reference: AgentExecutionJournalReferenceType): Promise<AgentExecutionJournalRecordType[]>;
};
