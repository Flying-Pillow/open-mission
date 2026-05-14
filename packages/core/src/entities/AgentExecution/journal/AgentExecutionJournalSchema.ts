import { z } from 'zod/v4';
import {
    AgentExecutionActivityProgressSchema,
    AgentExecutionActivityStateSchema,
    AgentExecutionActivityTargetSchema,
    AgentExecutionAttentionStateSchema,
    AgentExecutionCapabilityStateSchema,
    AgentExecutionLifecycleStateSchema,
    AgentExecutionTransportStateSchema
} from '../AgentExecutionStateSchema.js';
import {
    AgentExecutionProtocolDescriptorSchema,
    AgentExecutionProtocolOwnerEntitySchema
} from '../protocol/AgentExecutionProtocolSchema.js';
import {
    AgentExecutionJournalSignalSchema
} from '../protocol/AgentExecutionSignalRegistry.js';
export type {
    AgentExecutionJournalInputChoiceType,
    AgentExecutionJournalSignalConfidenceType,
    AgentExecutionJournalSignalSourceType,
    AgentExecutionJournalSignalType
} from '../protocol/AgentExecutionSignalRegistry.js';

const journalTextSchema = z.string().trim().min(1);
const journalPayloadSchema = z.record(z.string(), z.unknown());

export const AgentExecutionJournalSchemaVersionSchema = z.literal(1);

export const AgentExecutionJournalEntrySemanticsSchema = z.enum([
    'event',
    'snapshot',
    'assessment',
    'evidence'
]);

export const AgentExecutionJournalReasoningLevelSchema = z.enum([
    'low',
    'medium',
    'high',
    'max',
    'unknown'
]);

export const AgentExecutionJournalExecutionModeSchema = z.enum([
    'interactive',
    'batch',
    'verification',
    'audit'
]);

export const AgentExecutionJournalExecutionContextSchema = z.object({
    owner: z.object({
        entityType: AgentExecutionProtocolOwnerEntitySchema,
        entityId: journalTextSchema
    }).strict(),
    mission: z.object({
        missionId: journalTextSchema,
        stageId: journalTextSchema.optional(),
        taskId: journalTextSchema.optional(),
        sessionId: journalTextSchema.optional()
    }).strict().optional(),
    repository: z.object({
        repositoryId: journalTextSchema,
        worktreeId: journalTextSchema.optional(),
        branch: journalTextSchema.optional()
    }).strict().optional(),
    runtime: z.object({
        agentAdapter: journalTextSchema,
        provider: journalTextSchema.optional(),
        model: journalTextSchema.optional(),
        reasoningLevel: AgentExecutionJournalReasoningLevelSchema.optional(),
        executionMode: AgentExecutionJournalExecutionModeSchema.optional(),
        workflowStage: journalTextSchema.optional(),
        executionProfile: journalTextSchema.optional(),
        verifier: z.boolean().optional()
    }).strict(),
    daemon: z.object({
        runtimeVersion: journalTextSchema,
        protocolVersion: journalTextSchema
    }).strict()
}).strict();

export const AgentExecutionJournalRecordFamilySchema = z.enum([
    'journal.header',
    'turn.accepted',
    'turn.delivery',
    'agent-observation',
    'agent-execution-fact',
    'execution-assessment',
    'transport-evidence',
    'decision.recorded',
    'state.changed',
    'activity.updated',
    'owner-effect.recorded',
    'checkpoint.recorded',
    'timeline.recorded'
]);

export const AgentExecutionJournalRecordAuthoritySchema = z.enum([
    'daemon',
    'agent',
    'operator',
    'owner',
    'system',
    'derived'
]);

export const AgentExecutionJournalAssertionLevelSchema = z.enum([
    'authoritative',
    'advisory',
    'informational',
    'diagnostic'
]);

export const AgentExecutionJournalReplayClassSchema = z.enum([
    'replay-critical',
    'replay-optional',
    'evidence-only'
]);

export const AgentExecutionJournalOriginSchema = z.enum([
    'daemon',
    'operator',
    'system',
    'owner',
    'mcp',
    'sdk',
    'pty',
    'provider-output',
    'terminal-heuristic',
    'filesystem',
    'git',
    'timeline'
]);

export const AgentExecutionJournalRecordTypeSchema = z.enum([
    'journal.header',
    'turn.accepted',
    'turn.delivery',
    'agent-observation',
    'agent-execution-fact',
    'execution-assessment',
    'transport-evidence',
    'decision.recorded',
    'state.changed',
    'activity.updated',
    'owner-effect.recorded',
    'checkpoint.recorded',
    'timeline.recorded'
]);

export const AgentExecutionJournalRecordBaseSchema = z.object({
    recordId: journalTextSchema,
    sequence: z.number().int().nonnegative(),
    type: AgentExecutionJournalRecordTypeSchema,
    family: AgentExecutionJournalRecordFamilySchema,
    entrySemantics: AgentExecutionJournalEntrySemanticsSchema,
    authority: AgentExecutionJournalRecordAuthoritySchema,
    assertionLevel: AgentExecutionJournalAssertionLevelSchema,
    replayClass: AgentExecutionJournalReplayClassSchema,
    origin: AgentExecutionJournalOriginSchema,
    schemaVersion: AgentExecutionJournalSchemaVersionSchema,
    agentExecutionId: journalTextSchema,
    executionContext: AgentExecutionJournalExecutionContextSchema,
    occurredAt: journalTextSchema
}).strict();

export const AgentExecutionJournalKindSchema = z.literal('agent-execution-interaction-journal');

export const AgentExecutionJournalHeaderRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('journal.header'),
    family: z.literal('journal.header'),
    entrySemantics: z.literal('event'),
    kind: AgentExecutionJournalKindSchema,
    agentId: journalTextSchema,
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema,
    transportState: AgentExecutionTransportStateSchema.optional(),
    workingDirectory: journalTextSchema.optional()
}).strict();

export const AgentExecutionMessageSourceSchema = z.enum(['operator', 'daemon', 'system', 'owner']);

export const AgentExecutionMessageAcceptedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('turn.accepted'),
    family: z.literal('turn.accepted'),
    entrySemantics: z.literal('event'),
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
    type: z.literal('turn.delivery'),
    family: z.literal('turn.delivery'),
    entrySemantics: z.literal('event'),
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
    type: z.literal('agent-observation'),
    family: z.literal('agent-observation'),
    entrySemantics: z.literal('event'),
    observationId: journalTextSchema,
    source: AgentExecutionObservationSourceSchema,
    confidence: AgentExecutionObservationConfidenceSchema,
    signal: AgentExecutionJournalSignalSchema.optional(),
    rawText: z.string().optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionFactTypeSchema = z.enum([
    'artifact-read',
    'artifact-written',
    'tool-invoked',
    'tool-result',
    'filesystem-change',
    'provider-event'
]);

export const AgentExecutionFactRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('agent-execution-fact'),
    family: z.literal('agent-execution-fact'),
    entrySemantics: z.literal('event'),
    factId: journalTextSchema,
    factType: AgentExecutionFactTypeSchema,
    path: z.string().trim().min(1).optional(),
    artifactId: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionAssessmentTypeSchema = z.enum([
    'self-confidence',
    'verification-confidence',
    'retry-pressure',
    'instability',
    'contradiction-risk',
    'hallucination-risk',
    'task-stall-risk',
    'unresolved-concern',
    'verification-gap'
]);

export const AgentExecutionAssessmentRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('execution-assessment'),
    family: z.literal('execution-assessment'),
    entrySemantics: z.literal('assessment'),
    assessmentId: journalTextSchema,
    assessmentType: AgentExecutionAssessmentTypeSchema,
    detail: journalTextSchema.optional(),
    score: z.number().finite().optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionTransportEvidenceTypeSchema = z.enum([
    'stdout-chunk',
    'stderr-chunk',
    'provider-payload',
    'pty-snippet',
    'adapter-event'
]);

export const AgentExecutionTransportEvidenceRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('transport-evidence'),
    family: z.literal('transport-evidence'),
    entrySemantics: z.literal('evidence'),
    evidenceId: journalTextSchema,
    evidenceType: AgentExecutionTransportEvidenceTypeSchema,
    content: z.string().optional(),
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
    family: z.literal('decision.recorded'),
    entrySemantics: z.literal('event'),
    decisionId: journalTextSchema,
    observationId: journalTextSchema.optional(),
    messageId: journalTextSchema.optional(),
    action: AgentExecutionDecisionActionSchema,
    reason: journalTextSchema.optional()
}).strict();

export const AgentExecutionStateChangedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('state.changed'),
    family: z.literal('state.changed'),
    entrySemantics: z.literal('event'),
    lifecycle: AgentExecutionLifecycleStateSchema.optional(),
    attention: AgentExecutionAttentionStateSchema.optional(),
    activity: AgentExecutionActivityStateSchema.optional(),
    currentInputRequestId: journalTextSchema.nullable().optional(),
    awaitingResponseToMessageId: journalTextSchema.nullable().optional()
}).strict();

export const AgentExecutionActivityUpdatedRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('activity.updated'),
    family: z.literal('activity.updated'),
    entrySemantics: z.literal('snapshot'),
    activity: AgentExecutionActivityStateSchema.optional(),
    progress: AgentExecutionActivityProgressSchema.optional(),
    telemetry: z.object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        activeToolName: z.string().trim().min(1).optional()
    }).strict().optional(),
    capabilities: AgentExecutionCapabilityStateSchema.optional(),
    currentTarget: AgentExecutionActivityTargetSchema.optional()
}).strict();

export const AgentExecutionOwnerEffectRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('owner-effect.recorded'),
    family: z.literal('owner-effect.recorded'),
    entrySemantics: z.literal('event'),
    effectId: journalTextSchema,
    observationId: journalTextSchema.optional(),
    ownerEntity: z.enum(['System', 'Repository', 'Mission', 'Task', 'Artifact']),
    effectType: journalTextSchema,
    workflowEventId: journalTextSchema.optional(),
    entityEventId: journalTextSchema.optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionCheckpointRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('checkpoint.recorded'),
    family: z.literal('checkpoint.recorded'),
    entrySemantics: z.literal('snapshot'),
    checkpointId: journalTextSchema,
    detail: journalTextSchema.optional(),
    payload: journalPayloadSchema.optional()
}).strict();

export const AgentExecutionTimelineRecordSchema = AgentExecutionJournalRecordBaseSchema.extend({
    type: z.literal('timeline.recorded'),
    family: z.literal('timeline.recorded'),
    entrySemantics: z.literal('snapshot'),
    timeline: z.literal('timeline-item'),
    payload: journalPayloadSchema
}).strict();

export const AgentExecutionJournalRecordSchema = z.discriminatedUnion('type', [
    AgentExecutionJournalHeaderRecordSchema,
    AgentExecutionMessageAcceptedRecordSchema,
    AgentExecutionMessageDeliveryRecordSchema,
    AgentExecutionObservationRecordSchema,
    AgentExecutionFactRecordSchema,
    AgentExecutionAssessmentRecordSchema,
    AgentExecutionTransportEvidenceRecordSchema,
    AgentExecutionDecisionRecordSchema,
    AgentExecutionStateChangedRecordSchema,
    AgentExecutionActivityUpdatedRecordSchema,
    AgentExecutionOwnerEffectRecordSchema,
    AgentExecutionCheckpointRecordSchema,
    AgentExecutionTimelineRecordSchema
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
export type AgentExecutionJournalEntrySemanticsType = z.infer<typeof AgentExecutionJournalEntrySemanticsSchema>;
export type AgentExecutionJournalExecutionContextType = z.infer<typeof AgentExecutionJournalExecutionContextSchema>;
export type AgentExecutionJournalRecordFamilyType = z.infer<typeof AgentExecutionJournalRecordFamilySchema>;
export type AgentExecutionJournalRecordAuthorityType = z.infer<typeof AgentExecutionJournalRecordAuthoritySchema>;
export type AgentExecutionJournalAssertionLevelType = z.infer<typeof AgentExecutionJournalAssertionLevelSchema>;
export type AgentExecutionJournalReplayClassType = z.infer<typeof AgentExecutionJournalReplayClassSchema>;
export type AgentExecutionJournalOriginType = z.infer<typeof AgentExecutionJournalOriginSchema>;
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
export type AgentExecutionFactType = z.infer<typeof AgentExecutionFactTypeSchema>;
export type AgentExecutionFactRecordType = z.infer<typeof AgentExecutionFactRecordSchema>;
export type AgentExecutionAssessmentType = z.infer<typeof AgentExecutionAssessmentTypeSchema>;
export type AgentExecutionAssessmentRecordType = z.infer<typeof AgentExecutionAssessmentRecordSchema>;
export type AgentExecutionTransportEvidenceType = z.infer<typeof AgentExecutionTransportEvidenceTypeSchema>;
export type AgentExecutionTransportEvidenceRecordType = z.infer<typeof AgentExecutionTransportEvidenceRecordSchema>;
export type AgentExecutionDecisionActionType = z.infer<typeof AgentExecutionDecisionActionSchema>;
export type AgentExecutionDecisionRecordType = z.infer<typeof AgentExecutionDecisionRecordSchema>;
export type AgentExecutionAttentionStateType = z.infer<typeof AgentExecutionAttentionStateSchema>;
export type AgentExecutionActivityStateType = z.infer<typeof AgentExecutionActivityStateSchema>;
export type AgentExecutionStateChangedRecordType = z.infer<typeof AgentExecutionStateChangedRecordSchema>;
export type AgentExecutionActivityUpdatedRecordType = z.infer<typeof AgentExecutionActivityUpdatedRecordSchema>;
export type AgentExecutionOwnerEffectRecordType = z.infer<typeof AgentExecutionOwnerEffectRecordSchema>;
export type AgentExecutionCheckpointRecordType = z.infer<typeof AgentExecutionCheckpointRecordSchema>;
export type AgentExecutionTimelineRecordType = z.infer<typeof AgentExecutionTimelineRecordSchema>;
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
