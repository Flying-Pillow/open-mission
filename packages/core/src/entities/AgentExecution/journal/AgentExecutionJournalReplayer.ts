import {
    AgentExecutionTimelineSchema,
    AgentExecutionTimelineItemSchema,
    type AgentExecutionTimelineAttentionType,
    type AgentExecutionTimelineActivityType,
    type AgentExecutionTimelineType,
    type AgentExecutionTimelineItemType
} from '../timeline/AgentExecutionTimelineSchema.js';
import {
    type AgentExecutionActivityStateType,
    type AgentExecutionAttentionStateType,
    type AgentExecutionLifecycleStateType,
    type AgentExecutionLiveActivityType,
    type AgentExecutionTelemetryType,
    type AgentExecutionTransportStateType
} from '../AgentExecutionStateSchema.js';
import type { AgentExecutionProtocolDescriptorType } from '../protocol/AgentExecutionProtocolSchema.js';
import type { AgentExecutionType } from '../AgentExecutionSchema.js';
import type {
    AgentExecutionActivityUpdatedRecordType,
    AgentExecutionJournalHeaderRecordType,
    AgentExecutionJournalRecordType,
    AgentExecutionObservationRecordType,
    AgentExecutionFactRecordType
} from './AgentExecutionJournalSchema.js';
import { projectAgentExecutionObservationSignalToTimelineItem } from '../protocol/AgentExecutionSignalRegistry.js';

export type AgentExecutionJournalReplayState = {
    timeline: AgentExecutionTimelineType;
    processedMessageIds: Set<string>;
    processedObservationIds: Set<string>;
    lifecycleState?: AgentExecutionLifecycleStateType;
    attention?: AgentExecutionAttentionStateType;
    activityState?: AgentExecutionActivityStateType;
    currentInputRequestId?: string | null;
    awaitingResponseToMessageId?: string | null;
    liveActivity?: AgentExecutionLiveActivityType;
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    workingDirectory?: string;
    telemetry?: AgentExecutionTelemetryType;
    lastOccurredAt?: string;
};

export function replayAgentExecutionJournal(records: AgentExecutionJournalRecordType[]): AgentExecutionJournalReplayState {
    const timelineItems: AgentExecutionTimelineItemType[] = [];
    const processedMessageIds = new Set<string>();
    const processedObservationIds = new Set<string>();
    let header: AgentExecutionJournalHeaderRecordType | undefined;
    let lifecycleState: AgentExecutionLifecycleStateType | undefined;
    let attention: AgentExecutionAttentionStateType | undefined;
    let activityState: AgentExecutionActivityStateType | undefined;
    let currentInputRequestId: string | null | undefined;
    let awaitingResponseToMessageId: string | null | undefined;
    let liveActivity: AgentExecutionLiveActivityType | undefined;
    let telemetry: AgentExecutionTelemetryType | undefined;
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
            case 'agent-execution-fact':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromFact(record));
                break;
            case 'state.changed':
                lifecycleState = record.lifecycle ?? lifecycleState;
                attention = record.attention ?? attention;
                activityState = record.activity ?? activityState;
                if (record.currentInputRequestId !== undefined) {
                    currentInputRequestId = record.currentInputRequestId;
                }
                if (record.awaitingResponseToMessageId !== undefined) {
                    awaitingResponseToMessageId = record.awaitingResponseToMessageId;
                }
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromStateChangedRecord(record));
                break;
            case 'activity.updated':
                activityState = record.activity ?? activityState;
                liveActivity = mergeLiveActivity(liveActivity, record);
                telemetry = mergeTelemetry(telemetry, record);
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromActivityRecord(record));
                break;
            case 'owner-effect.recorded':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromOwnerEffectRecord(record));
                break;
            case 'timeline.recorded':
                appendUniqueTimelineItem(timelineItems, toTimelineItemFromTimelineRecord(record));
                break;
            default:
                break;
        }
    }

    const derivedActivityState = deriveActivityState({
        lifecycleState,
        awaitingResponseToMessageId,
        activityState,
    });

    const timeline = AgentExecutionTimelineSchema.parse({
        timelineItems,
        ...(liveActivity || lifecycleState || attention || derivedActivityState || telemetry
            ? {
                currentActivity: createCurrentActivityTimeline({
                    lifecycleState,
                    attention,
                    activityState: derivedActivityState,
                    liveActivity,
                    telemetry,
                    lastOccurredAt
                })
            }
            : {}),
        ...(attention && lastOccurredAt
            ? {
                currentAttention: createCurrentAttentionTimeline({
                    attention,
                    currentInputRequestId,
                    timelineItems,
                    lastOccurredAt
                })
            }
            : {})
    });

    return {
        timeline,
        processedMessageIds,
        processedObservationIds,
        ...(lifecycleState ? { lifecycleState } : {}),
        ...(attention ? { attention } : {}),
        ...(derivedActivityState ? { activityState: derivedActivityState } : {}),
        ...(currentInputRequestId !== undefined ? { currentInputRequestId } : {}),
        ...(awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId } : {}),
        ...(liveActivity ? { liveActivity } : {}),
        ...(header?.protocolDescriptor ? { protocolDescriptor: header.protocolDescriptor } : {}),
        ...(header?.transportState ? { transportState: header.transportState } : {}),
        ...(header?.workingDirectory ? { workingDirectory: header.workingDirectory } : {}),
        ...(telemetry ? { telemetry } : {}),
        ...(lastOccurredAt ? { lastOccurredAt } : {})
    };
}

export function hydrateAgentExecutionDataFromJournal(
    data: AgentExecutionType,
    records: AgentExecutionJournalRecordType[]
): AgentExecutionType {
    const replay = replayAgentExecutionJournal(records);
    const lifecycleState = replay.lifecycleState ?? data.lifecycleState;
    const attention = replay.attention ?? data.attention;
    const activityState = deriveActivityState({
        lifecycleState,
        awaitingResponseToMessageId: replay.awaitingResponseToMessageId ?? data.awaitingResponseToMessageId,
        activityState: replay.activityState ?? data.activityState,
    });
    const liveActivity = replay.liveActivity ?? data.liveActivity;
    const timeline = AgentExecutionTimelineSchema.parse({
        ...replay.timeline,
        ...(createCurrentActivityTimeline({
            lifecycleState,
            attention,
            activityState,
            liveActivity,
            telemetry: replay.telemetry ?? data.telemetry,
            lastOccurredAt: replay.lastOccurredAt ?? data.lastUpdatedAt
        })
            ? {
                currentActivity: createCurrentActivityTimeline({
                    lifecycleState,
                    attention,
                    activityState,
                    liveActivity,
                    telemetry: replay.telemetry ?? data.telemetry,
                    lastOccurredAt: replay.lastOccurredAt ?? data.lastUpdatedAt
                })
            }
            : {})
    });
    return {
        ...data,
        journalRecords: structuredClone(records),
        timeline,
        ...(replay.lifecycleState ? { lifecycleState: replay.lifecycleState } : {}),
        ...(replay.attention ? { attention: replay.attention } : {}),
        ...(activityState ? { activityState } : {}),
        ...(replay.currentInputRequestId !== undefined ? { currentInputRequestId: replay.currentInputRequestId } : {}),
        ...(replay.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: replay.awaitingResponseToMessageId } : {}),
        ...(liveActivity ? { liveActivity } : {}),
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

function toTimelineItemFromFact(record: AgentExecutionFactRecordType): AgentExecutionTimelineItemType | undefined {
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
    const currentTarget = record['currentTarget'];
    if (!record.activity && !record.progress && !currentTarget && !record.telemetry?.activeToolName) {
        return undefined;
    }
    const primitive = record.progress
        ? 'activity.progress'
        : record.telemetry?.activeToolName
            ? 'activity.tool'
            : currentTarget
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
            ...(currentTarget ? { currentTarget } : {}),
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

function toTimelineItemFromTimelineRecord(
    record: Extract<AgentExecutionJournalRecordType, { type: 'timeline.recorded' }>
): AgentExecutionTimelineItemType | undefined {
    if (record.timeline !== 'timeline-item') {
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

function createCurrentActivityTimeline(input: {
    lifecycleState: AgentExecutionLifecycleStateType | undefined;
    attention: AgentExecutionAttentionStateType | undefined;
    activityState: AgentExecutionActivityStateType | undefined;
    liveActivity: AgentExecutionLiveActivityType | undefined;
    telemetry: AgentExecutionTelemetryType | undefined;
    lastOccurredAt: string | undefined;
}): AgentExecutionTimelineActivityType | undefined {
    const updatedAt = input.liveActivity?.updatedAt ?? input.telemetry?.updatedAt ?? input.lastOccurredAt;
    if (!updatedAt) {
        return undefined;
    }
    return {
        updatedAt,
        ...(input.lifecycleState ? { lifecycleState: input.lifecycleState } : {}),
        ...(input.attention ? { attention: input.attention } : {}),
        ...(input.activityState
            ? { activity: input.activityState }
            : {}),
        ...(input.liveActivity?.progress?.summary ? { summary: input.liveActivity.progress.summary } : {}),
        ...(input.liveActivity?.progress?.detail ? { detail: input.liveActivity.progress.detail } : {}),
        ...(input.liveActivity?.progress?.units ? { units: input.liveActivity.progress.units } : {}),
        ...(input.liveActivity?.currentTarget ? { currentTarget: input.liveActivity.currentTarget } : {}),
        ...(input.telemetry?.activeToolName ? { activeToolName: input.telemetry.activeToolName } : {})
    };
}

function deriveActivityState(input: {
    lifecycleState: AgentExecutionLifecycleStateType | undefined;
    awaitingResponseToMessageId: string | null | undefined;
    activityState: AgentExecutionActivityStateType | undefined;
}): AgentExecutionActivityStateType | undefined {
    const baseActivity = input.activityState;
    if (input.lifecycleState !== 'running' && input.lifecycleState !== 'starting') {
        return baseActivity;
    }
    if (input.awaitingResponseToMessageId !== undefined && input.awaitingResponseToMessageId !== null) {
        return 'awaiting-agent-response';
    }
    return baseActivity;
}

function createCurrentAttentionTimeline(input: {
    attention: AgentExecutionAttentionStateType;
    currentInputRequestId: string | null | undefined;
    timelineItems: AgentExecutionTimelineItemType[];
    lastOccurredAt: string;
}): AgentExecutionTimelineAttentionType | undefined {
    if (input.attention === 'none' || input.attention === 'autonomous') {
        return undefined;
    }
    const attentionItem = resolveCurrentAttentionTimelineItem(input.timelineItems, input.currentInputRequestId);
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

function resolveCurrentAttentionTimelineItem(
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
    current: AgentExecutionTelemetryType | undefined,
    record: AgentExecutionActivityUpdatedRecordType
): AgentExecutionTelemetryType | undefined {
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

function mergeLiveActivity(
    current: AgentExecutionLiveActivityType | undefined,
    record: AgentExecutionActivityUpdatedRecordType
): AgentExecutionLiveActivityType | undefined {
    const currentTarget = record['currentTarget'];
    if (!record.progress && !record.capabilities && !currentTarget) {
        return current;
    }
    return {
        ...(current ?? { updatedAt: record.occurredAt }),
        ...(record.progress ? { progress: record.progress } : {}),
        ...(record.capabilities ? { capabilities: record.capabilities } : {}),
        ...(currentTarget ? { currentTarget } : {}),
        updatedAt: record.occurredAt
    };
}