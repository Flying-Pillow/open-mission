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
    AgentExecutionObservationRecordType
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
    let runtimeActivity: AgentExecutionRuntimeActivitySnapshotType | undefined;
    let telemetry: AgentExecutionTelemetrySnapshot | undefined;
    let lastOccurredAt: string | undefined;

    for (const record of records) {
        lastOccurredAt = record.occurredAt;
        switch (record.type) {
            case 'journal.header':
                header = record;
                break;
            case 'message.accepted':
                processedMessageIds.add(record.messageId);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromAcceptedMessage(record));
                break;
            case 'observation.recorded':
                processedObservationIds.add(record.observationId);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromObservation(record));
                break;
            case 'state.changed':
                lifecycleState = record.lifecycle ?? lifecycleState;
                attention = record.attention ?? attention;
                semanticActivity = record.activity ?? semanticActivity;
                if (record.currentInputRequestId !== undefined) {
                    currentInputRequestId = record.currentInputRequestId;
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

    const projection = AgentExecutionProjectionSchema.parse({
        timelineItems,
        ...(runtimeActivity || lifecycleState || attention || semanticActivity || telemetry
            ? {
                currentActivity: createCurrentActivityProjection({
                    lifecycleState,
                    attention,
                    semanticActivity,
                    runtimeActivity,
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
        ...(semanticActivity ? { semanticActivity } : {}),
        ...(currentInputRequestId !== undefined ? { currentInputRequestId } : {}),
        ...(runtimeActivity ? { runtimeActivity } : {}),
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
    return {
        ...data,
        projection: replay.projection,
        ...(replay.lifecycleState ? { lifecycleState: replay.lifecycleState } : {}),
        ...(replay.attention ? { attention: replay.attention } : {}),
        ...(replay.semanticActivity ? { semanticActivity: replay.semanticActivity } : {}),
        ...(replay.currentInputRequestId !== undefined ? { currentInputRequestId: replay.currentInputRequestId } : {}),
        ...(replay.runtimeActivity ? { runtimeActivity: replay.runtimeActivity } : {}),
        ...(replay.protocolDescriptor ? { protocolDescriptor: replay.protocolDescriptor } : {}),
        ...(replay.transportState ? { transportState: replay.transportState } : {}),
        ...(replay.workingDirectory && !data.workingDirectory ? { workingDirectory: replay.workingDirectory } : {}),
        ...(replay.telemetry ? { telemetry: replay.telemetry } : {}),
        ...(replay.lastOccurredAt ? { lastUpdatedAt: replay.lastOccurredAt } : {})
    };
}

function toTimelineItemFromAcceptedMessage(record: Extract<AgentExecutionJournalRecordType, { type: 'message.accepted' }>): AgentExecutionTimelineItemType | undefined {
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

function toTimelineItemFromStateChangedRecord(
    record: Extract<AgentExecutionJournalRecordType, { type: 'state.changed' }>
): AgentExecutionTimelineItemType | undefined {
    const parts = [
        record.lifecycle ? `Lifecycle: ${record.lifecycle}` : undefined,
        record.attention ? `Attention: ${record.attention}` : undefined,
        record.activity ? `Activity: ${record.activity}` : undefined,
        record.currentInputRequestId !== undefined
            ? `Input request: ${record.currentInputRequestId ?? 'cleared'}`
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

function createCurrentAttentionProjection(input: {
    attention: AgentExecutionAttentionStateType;
    currentInputRequestId: string | null | undefined;
    timelineItems: AgentExecutionTimelineItemType[];
    lastOccurredAt: string;
}): AgentExecutionAttentionProjectionType | undefined {
    if (input.attention === 'none' || input.attention === 'autonomous') {
        return undefined;
    }
    const latestAttentionItem = [...input.timelineItems].reverse().find((item) => item.primitive.startsWith('attention.'));
    const primitive = latestAttentionItem?.primitive;
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
        ...(latestAttentionItem?.severity ? { severity: latestAttentionItem.severity } : {}),
        ...(latestAttentionItem?.payload.title ? { title: latestAttentionItem.payload.title } : {}),
        ...(latestAttentionItem?.payload.text ? { text: latestAttentionItem.payload.text } : {}),
        ...(latestAttentionItem?.payload.detail ? { detail: latestAttentionItem.payload.detail } : {}),
        ...(latestAttentionItem?.payload.choices ? { choices: latestAttentionItem.payload.choices } : {}),
        ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
        updatedAt: latestAttentionItem?.occurredAt ?? input.lastOccurredAt
    };
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