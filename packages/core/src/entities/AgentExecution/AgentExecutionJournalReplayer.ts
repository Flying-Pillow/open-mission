import {
    AgentExecutionProjectionSchema,
    AgentExecutionTimelineItemSchema,
    type AgentExecutionAttentionStateType,
    type AgentExecutionAttentionProjectionType,
    type AgentExecutionDataType,
    type AgentExecutionActivityProjectionType,
    type AgentExecutionLifecycleStateType,
    type AgentExecutionProjectionType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionRuntimeActivitySnapshotType,
    type AgentExecutionSemanticActivityType,
    type AgentExecutionTimelineItemType,
    type AgentExecutionTelemetrySnapshot,
    type AgentExecutionTransportStateType
} from './AgentExecutionSchema.js';
import type {
    AgentExecutionActivityUpdatedRecordType,
    AgentExecutionJournalHeaderRecordType,
    AgentExecutionJournalRecordType,
    AgentExecutionObservationRecordType,
    AgentExecutionRuntimeFactRecordType
} from './AgentExecutionJournalSchema.js';
import { projectAgentExecutionObservationSignalToTimelineItem } from './AgentExecutionSignalRegistry.js';

export type AgentExecutionJournalReplayState = {
    projection: AgentExecutionProjectionType;
    processedMessageIds: Set<string>;
    processedObservationIds: Set<string>;
    lifecycleState?: AgentExecutionLifecycleStateType;
    attention?: AgentExecutionAttentionStateType;
    semanticActivity?: AgentExecutionSemanticActivityType;
    currentInputRequestId?: string | null;
    awaitingResponseToMessageId?: string | null;
    runtimeActivity?: AgentExecutionRuntimeActivitySnapshotType;
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    workingDirectory?: string;
    telemetry?: AgentExecutionTelemetrySnapshot;
    lastOccurredAt?: string;
};

export function replayAgentExecutionJournal(records: AgentExecutionJournalRecordType[]): AgentExecutionJournalReplayState {
    const timelineItems: AgentExecutionTimelineItemType[] = [];
    const processedMessageIds = new Set<string>();
    const processedObservationIds = new Set<string>();
    let header: AgentExecutionJournalHeaderRecordType | undefined;
    let lifecycleState: AgentExecutionLifecycleStateType | undefined;
    let attention: AgentExecutionAttentionStateType | undefined;
    let semanticActivity: AgentExecutionSemanticActivityType | undefined;
    let currentInputRequestId: string | null | undefined;
    let awaitingResponseToMessageId: string | null | undefined;
    let runtimeActivity: AgentExecutionRuntimeActivitySnapshotType | undefined;
    let telemetry: AgentExecutionTelemetrySnapshot | undefined;
    let lastOccurredAt: string | undefined;

    for (const record of records) {
        lastOccurredAt = record.occurredAt;
        switch (record.type) {
            case 'journal.header':
                header = record;
                break;
            case 'turn.accepted':
                processedMessageIds.add(record.messageId);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromAcceptedMessage(record));
                break;
            case 'agent-observation':
                processedObservationIds.add(record.observationId);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromObservation(record));
                break;
            case 'runtime-fact':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromRuntimeFact(record));
                break;
            case 'state.changed':
                lifecycleState = record.lifecycle ?? lifecycleState;
                attention = record.attention ?? attention;
                semanticActivity = record.activity ?? semanticActivity;
                if (record.currentInputRequestId !== undefined) {
                    currentInputRequestId = record.currentInputRequestId;
                }
                if (record.awaitingResponseToMessageId !== undefined) {
                    awaitingResponseToMessageId = record.awaitingResponseToMessageId;
                }
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromStateChangedRecord(record));
                break;
            case 'activity.updated':
                runtimeActivity = mergeRuntimeActivity(runtimeActivity, record);
                telemetry = mergeTelemetry(telemetry, record);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromActivityRecord(record));
                break;
            case 'owner-effect.recorded':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromOwnerEffectRecord(record));
                break;
            case 'projection.recorded':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromProjectionRecord(record));
                break;
            default:
                break;
        }
    }

    const derivedSemanticActivity = deriveSemanticActivity({
        lifecycleState,
        awaitingResponseToMessageId,
        semanticActivity,
        runtimeActivity,
    });
    const projectedRuntimeActivity = applySemanticActivityOverride(runtimeActivity, derivedSemanticActivity);

    const projection = AgentExecutionProjectionSchema.parse({
        timelineItems,
        ...(projectedRuntimeActivity || lifecycleState || attention || derivedSemanticActivity || telemetry
            ? {
                currentActivity: createCurrentActivityProjection({
                    lifecycleState,
                    attention,
                    semanticActivity: derivedSemanticActivity,
                    runtimeActivity: projectedRuntimeActivity,
                    telemetry,
                    lastOccurredAt
                })
            }
            : {}),
        ...(attention && lastOccurredAt
            ? {
                currentAttention: createCurrentAttentionProjection({
                    attention,
                    currentInputRequestId,
                    timelineItems,
                    lastOccurredAt
                })
            }
            : {})
    });

    return {
        projection,
        processedMessageIds,
        processedObservationIds,
        ...(lifecycleState ? { lifecycleState } : {}),
        ...(attention ? { attention } : {}),
        ...(derivedSemanticActivity ? { semanticActivity: derivedSemanticActivity } : {}),
        ...(currentInputRequestId !== undefined ? { currentInputRequestId } : {}),
        ...(awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId } : {}),
        ...(projectedRuntimeActivity ? { runtimeActivity: projectedRuntimeActivity } : {}),
        ...(header?.protocolDescriptor ? { protocolDescriptor: header.protocolDescriptor } : {}),
        ...(header?.transportState ? { transportState: header.transportState } : {}),
        ...(header?.workingDirectory ? { workingDirectory: header.workingDirectory } : {}),
        ...(telemetry ? { telemetry } : {}),
        ...(lastOccurredAt ? { lastOccurredAt } : {})
    };
}

export function hydrateAgentExecutionDataFromJournal(
    data: AgentExecutionDataType,
    records: AgentExecutionJournalRecordType[]
): AgentExecutionDataType {
    const replay = replayAgentExecutionJournal(records);
    const lifecycleState = replay.lifecycleState ?? data.lifecycleState;
    const attention = replay.attention ?? data.attention;
    const semanticActivity = deriveSemanticActivity({
        lifecycleState,
        awaitingResponseToMessageId: replay.awaitingResponseToMessageId ?? data.awaitingResponseToMessageId,
        semanticActivity: replay.semanticActivity ?? data.semanticActivity,
        runtimeActivity: replay.runtimeActivity ?? data.runtimeActivity,
    });
    const runtimeActivity = applySemanticActivityOverride(replay.runtimeActivity ?? data.runtimeActivity, semanticActivity);
    const projection = AgentExecutionProjectionSchema.parse({
        ...replay.projection,
        ...(createCurrentActivityProjection({
            lifecycleState,
            attention,
            semanticActivity,
            runtimeActivity,
            telemetry: replay.telemetry ?? data.telemetry,
            lastOccurredAt: replay.lastOccurredAt ?? data.lastUpdatedAt
        })
            ? {
                currentActivity: createCurrentActivityProjection({
                    lifecycleState,
                    attention,
                    semanticActivity,
                    runtimeActivity,
                    telemetry: replay.telemetry ?? data.telemetry,
                    lastOccurredAt: replay.lastOccurredAt ?? data.lastUpdatedAt
                })
            }
            : {})
    });
    return {
        ...data,
        journalRecords: structuredClone(records),
        projection,
        ...(replay.lifecycleState ? { lifecycleState: replay.lifecycleState } : {}),
        ...(replay.attention ? { attention: replay.attention } : {}),
        ...(semanticActivity ? { semanticActivity } : {}),
        ...(replay.currentInputRequestId !== undefined ? { currentInputRequestId: replay.currentInputRequestId } : {}),
        ...(replay.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: replay.awaitingResponseToMessageId } : {}),
        ...(runtimeActivity ? { runtimeActivity } : {}),
        ...(replay.protocolDescriptor ? { protocolDescriptor: replay.protocolDescriptor } : {}),
        ...(replay.transportState ? { transportState: replay.transportState } : {}),
        ...(replay.workingDirectory && !data.workingDirectory ? { workingDirectory: replay.workingDirectory } : {}),
        ...(replay.telemetry ? { telemetry: replay.telemetry } : {}),
        ...(replay.lastOccurredAt ? { lastUpdatedAt: replay.lastOccurredAt } : {})
    };
}

function toTimelineItemFromAcceptedMessage(record: Extract<AgentExecutionJournalRecordType, { type: 'turn.accepted' }>): AgentExecutionTimelineItemType | undefined {
    const text = readMessageText(record.payload);
    if (!text) {
        return undefined;
    }
    return AgentExecutionTimelineItemSchema.parse({
        id: record.messageId,
        occurredAt: record.occurredAt,
        zone: 'conversation',
        primitive: record.source === 'operator'
            ? 'conversation.operator-message'
            : 'conversation.system-message',
        behavior: createBehavior('conversational'),
        provenance: {
            durable: true,
            sourceRecordIds: [record.recordId],
            confidence: 'authoritative'
        },
        payload: {
            text
        }
    });
}

function toTimelineItemFromObservation(record: AgentExecutionObservationRecordType): AgentExecutionTimelineItemType | undefined {
    const signal = record.signal;
    if (!signal) {
        return undefined;
    }

    return projectAgentExecutionObservationSignalToTimelineItem({
        itemId: record.observationId,
        occurredAt: record.occurredAt,
        signal,
        provenance: {
            durable: true,
            sourceRecordIds: [record.recordId],
            confidence: signal.confidence
        }
    });
}

function toTimelineItemFromRuntimeFact(record: AgentExecutionRuntimeFactRecordType): AgentExecutionTimelineItemType | undefined {
    if (record.replayClass === 'evidence-only') {
        return undefined;
    }

    if (record.factType === 'artifact-read' && record.path) {
        return AgentExecutionTimelineItemSchema.parse({
            id: record.factId,
            occurredAt: record.occurredAt,
            zone: 'activity',
            primitive: 'activity.tool',
            behavior: createBehavior('live-activity', { compactable: true }),
            provenance: {
                durable: true,
                sourceRecordIds: [record.recordId],
                confidence: record.assertionLevel === 'authoritative' ? 'authoritative' : 'medium'
            },
            payload: {
                title: 'Reading artifact',
                ...(record.detail ? { text: record.detail } : {}),
                path: record.path,
                currentTarget: {
                    kind: 'artifact',
                    path: record.path,
                    label: record.path.split('/').at(-1) ?? record.path
                },
                artifacts: [{
                    ...(record.artifactId ? { artifactId: record.artifactId } : {}),
                    path: record.path,
                    activity: 'read'
                }]
            }
        });
    }

    return undefined;
}

function toTimelineItemFromStateChangedRecord(
    record: Extract<AgentExecutionJournalRecordType, { type: 'state.changed' }>
): AgentExecutionTimelineItemType | undefined {
    const parts = [
        record.lifecycle ? `Lifecycle: ${record.lifecycle}` : undefined,
        record.attention ? `Attention: ${record.attention}` : undefined,
        record.activity ? `Activity: ${record.activity}` : undefined,
        record.currentInputRequestId !== undefined
            ? `Input request: ${record.currentInputRequestId ?? 'cleared'}`
            : undefined,
        record.awaitingResponseToMessageId !== undefined
            ? `Awaiting response to: ${record.awaitingResponseToMessageId ?? 'cleared'}`
            : undefined
    ].filter((value): value is string => Boolean(value));
    if (parts.length === 0) {
        return undefined;
    }
    return AgentExecutionTimelineItemSchema.parse({
        id: `${record.recordId}:state`,
        occurredAt: record.occurredAt,
        zone: 'workflow',
        primitive: 'workflow.state-changed',
        behavior: createBehavior('timeline-event', { compactable: true }),
        provenance: {
            durable: true,
            sourceRecordIds: [record.recordId],
            confidence: 'authoritative'
        },
        payload: {
            title: 'Execution state changed',
            text: parts.join('\n')
        }
    });
}

function toTimelineItemFromActivityRecord(record: AgentExecutionActivityUpdatedRecordType): AgentExecutionTimelineItemType | undefined {
    if (!record.activity && !record.progress && !record.currentTarget && !record.telemetry?.activeToolName) {
        return undefined;
    }
    const primitive = record.progress
        ? 'activity.progress'
        : record.telemetry?.activeToolName
            ? 'activity.tool'
            : record.currentTarget
                ? 'activity.target'
                : 'activity.status';
    return AgentExecutionTimelineItemSchema.parse({
        id: `${record.recordId}:activity`,
        occurredAt: record.occurredAt,
        zone: 'activity',
        primitive,
        behavior: createBehavior('live-activity', { compactable: true }),
        provenance: {
            durable: true,
            sourceRecordIds: [record.recordId],
            confidence: 'authoritative'
        },
        payload: {
            title: record.activity ? `Activity: ${record.activity}` : 'Activity update',
            ...(record.progress?.summary ? { text: record.progress.summary, summary: record.progress.summary } : {}),
            ...(record.progress?.detail ? { detail: record.progress.detail } : {}),
            ...(record.progress?.units ? { units: record.progress.units } : {}),
            ...(record.currentTarget ? { currentTarget: record.currentTarget } : {}),
            ...(record.telemetry?.activeToolName ? { activeToolName: record.telemetry.activeToolName } : {})
        }
    });
}

function toTimelineItemFromOwnerEffectRecord(
    record: Extract<AgentExecutionJournalRecordType, { type: 'owner-effect.recorded' }>
): AgentExecutionTimelineItemType {
    return AgentExecutionTimelineItemSchema.parse({
        id: `${record.recordId}:owner-effect`,
        occurredAt: record.occurredAt,
        zone: 'workflow',
        primitive: 'workflow.event',
        behavior: createBehavior('timeline-event', { compactable: true }),
        provenance: {
            durable: true,
            sourceRecordIds: [record.recordId],
            confidence: 'authoritative'
        },
        payload: {
            title: record.effectType,
            entity: record.ownerEntity,
            ...(record.workflowEventId ? { workflowEventId: record.workflowEventId } : {}),
            ...(record.entityEventId ? { entityEventId: record.entityEventId } : {})
        }
    });
}

function toTimelineItemFromProjectionRecord(
    record: Extract<AgentExecutionJournalRecordType, { type: 'projection.recorded' }>
): AgentExecutionTimelineItemType | undefined {
    if (record.projection !== 'timeline-item') {
        return undefined;
    }
    return AgentExecutionTimelineItemSchema.parse(record.payload);
}

function readMessageText(payload: unknown): string | undefined {
    if (typeof payload === 'string') {
        return payload.trim() || undefined;
    }
    if (typeof payload === 'object' && payload !== null && 'text' in payload && typeof payload.text === 'string') {
        return payload.text.trim() || undefined;
    }
    return undefined;
}

function appendUniqueTimelineItem(timelineItems: AgentExecutionTimelineItemType[], item: AgentExecutionTimelineItemType | undefined): void {
    if (!item || timelineItems.some((existing) => existing.id === item.id)) {
        return;
    }
    timelineItems.push(item);
}

function createBehavior(
    behaviorClass: AgentExecutionTimelineItemType['behavior']['class'],
    overrides: Partial<AgentExecutionTimelineItemType['behavior']> = {}
): AgentExecutionTimelineItemType['behavior'] {
    return {
        class: behaviorClass,
        compactable: false,
        collapsible: false,
        sticky: false,
        actionable: false,
        replayRelevant: true,
        transient: false,
        defaultExpanded: true,
        ...overrides
    };
}

function createCurrentActivityProjection(input: {
    lifecycleState: AgentExecutionLifecycleStateType | undefined;
    attention: AgentExecutionAttentionStateType | undefined;
    semanticActivity: AgentExecutionSemanticActivityType | undefined;
    runtimeActivity: AgentExecutionRuntimeActivitySnapshotType | undefined;
    telemetry: AgentExecutionTelemetrySnapshot | undefined;
    lastOccurredAt: string | undefined;
}): AgentExecutionActivityProjectionType | undefined {
    const updatedAt = input.runtimeActivity?.updatedAt ?? input.telemetry?.updatedAt ?? input.lastOccurredAt;
    if (!updatedAt) {
        return undefined;
    }
    return {
        updatedAt,
        ...(input.lifecycleState ? { lifecycleState: input.lifecycleState } : {}),
        ...(input.attention ? { attention: input.attention } : {}),
        ...(input.runtimeActivity?.activity ?? input.semanticActivity
            ? { activity: input.runtimeActivity?.activity ?? input.semanticActivity }
            : {}),
        ...(input.runtimeActivity?.progress?.summary ? { summary: input.runtimeActivity.progress.summary } : {}),
        ...(input.runtimeActivity?.progress?.detail ? { detail: input.runtimeActivity.progress.detail } : {}),
        ...(input.runtimeActivity?.progress?.units ? { units: input.runtimeActivity.progress.units } : {}),
        ...(input.runtimeActivity?.currentTarget ? { currentTarget: input.runtimeActivity.currentTarget } : {}),
        ...(input.telemetry?.activeToolName ? { activeToolName: input.telemetry.activeToolName } : {})
    };
}

function deriveSemanticActivity(input: {
    lifecycleState: AgentExecutionLifecycleStateType | undefined;
    awaitingResponseToMessageId: string | null | undefined;
    semanticActivity: AgentExecutionSemanticActivityType | undefined;
    runtimeActivity: AgentExecutionRuntimeActivitySnapshotType | undefined;
}): AgentExecutionSemanticActivityType | undefined {
    const baseActivity = input.runtimeActivity?.activity ?? input.semanticActivity;
    if (input.lifecycleState !== 'running' && input.lifecycleState !== 'starting') {
        return baseActivity;
    }
    if (input.awaitingResponseToMessageId !== undefined && input.awaitingResponseToMessageId !== null) {
        return 'awaiting-agent-response';
    }
    return baseActivity;
}

function applySemanticActivityOverride(
    runtimeActivity: AgentExecutionRuntimeActivitySnapshotType | undefined,
    semanticActivity: AgentExecutionSemanticActivityType | undefined
): AgentExecutionRuntimeActivitySnapshotType | undefined {
    if (!runtimeActivity) {
        return runtimeActivity;
    }
    if (!semanticActivity || runtimeActivity.activity === semanticActivity) {
        return runtimeActivity;
    }
    if (runtimeActivity.activity !== 'executing') {
        return runtimeActivity;
    }
    return {
        ...runtimeActivity,
        activity: semanticActivity
    };
}

function createCurrentAttentionProjection(input: {
    attention: AgentExecutionAttentionStateType;
    currentInputRequestId: string | null | undefined;
    timelineItems: AgentExecutionTimelineItemType[];
    lastOccurredAt: string;
}): AgentExecutionAttentionProjectionType | undefined {
    if (input.attention === 'none' || input.attention === 'autonomous') {
        return undefined;
    }
    const attentionItem = resolveCurrentAttentionProjectionItem(input.timelineItems, input.currentInputRequestId);
    const primitive = attentionItem?.primitive;
    if (
        primitive !== 'attention.input-request'
        && primitive !== 'attention.blocked'
        && primitive !== 'attention.verification-requested'
        && primitive !== 'attention.verification-result'
    ) {
        return {
            state: input.attention,
            primitive: input.currentInputRequestId ? 'attention.input-request' : 'attention.blocked',
            ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
            updatedAt: input.lastOccurredAt
        };
    }
    return {
        state: input.attention,
        primitive,
        ...(attentionItem?.severity ? { severity: attentionItem.severity } : {}),
        ...(attentionItem?.payload.title ? { title: attentionItem.payload.title } : {}),
        ...(attentionItem?.payload.text ? { text: attentionItem.payload.text } : {}),
        ...(attentionItem?.payload.detail ? { detail: attentionItem.payload.detail } : {}),
        ...(attentionItem?.payload.choices ? { choices: attentionItem.payload.choices } : {}),
        ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
        updatedAt: attentionItem?.occurredAt ?? input.lastOccurredAt
    };
}

function resolveCurrentAttentionProjectionItem(
    timelineItems: AgentExecutionTimelineItemType[],
    currentInputRequestId: string | null | undefined
): AgentExecutionTimelineItemType | undefined {
    if (currentInputRequestId) {
        const inputRequestItem = timelineItems.find((item) => item.id === currentInputRequestId);
        if (inputRequestItem?.primitive === 'attention.input-request') {
            return inputRequestItem;
        }
    }
    return [...timelineItems]
        .reverse()
        .find(
            (item) =>
                item.primitive.startsWith('attention.') &&
                item.primitive !== 'attention.input-request',
        );
}

function mergeTelemetry(
    current: AgentExecutionTelemetrySnapshot | undefined,
    record: AgentExecutionActivityUpdatedRecordType
): AgentExecutionTelemetrySnapshot | undefined {
    if (!record.telemetry) {
        return current;
    }
    return {
        ...(current ?? {}),
        ...(record.telemetry.activeToolName ? { activeToolName: record.telemetry.activeToolName } : {}),
        updatedAt: record.occurredAt,
        tokenUsage: {
            ...(current?.tokenUsage ?? {}),
            ...(record.telemetry.inputTokens !== undefined ? { inputTokens: record.telemetry.inputTokens } : {}),
            ...(record.telemetry.outputTokens !== undefined ? { outputTokens: record.telemetry.outputTokens } : {}),
            ...(record.telemetry.totalTokens !== undefined ? { totalTokens: record.telemetry.totalTokens } : {})
        }
    };
}

function mergeRuntimeActivity(
    current: AgentExecutionRuntimeActivitySnapshotType | undefined,
    record: AgentExecutionActivityUpdatedRecordType
): AgentExecutionRuntimeActivitySnapshotType | undefined {
    if (!record.activity && !record.progress && !record.capabilities && !record.currentTarget) {
        return current;
    }
    return {
        ...(current ?? { updatedAt: record.occurredAt }),
        ...(record.activity ? { activity: record.activity } : {}),
        ...(record.progress ? { progress: record.progress } : {}),
        ...(record.capabilities ? { capabilities: record.capabilities } : {}),
        ...(record.currentTarget ? { currentTarget: record.currentTarget } : {}),
        updatedAt: record.occurredAt
    };
}