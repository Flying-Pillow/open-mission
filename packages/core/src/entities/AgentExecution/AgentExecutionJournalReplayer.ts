import {
    AgentExecutionChatMessageSchema,
    type AgentExecutionChatMessageType,
    type AgentExecutionAttentionStateType,
    type AgentExecutionDataType,
    type AgentExecutionLifecycleStateType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionRuntimeActivitySnapshotType,
    type AgentExecutionSemanticActivityType,
    type AgentExecutionTelemetrySnapshot,
    type AgentExecutionTransportStateType
} from './AgentExecutionSchema.js';
import type {
    AgentExecutionActivityUpdatedRecordType,
    AgentExecutionJournalHeaderRecordType,
    AgentExecutionJournalRecordType,
    AgentExecutionObservationRecordType
} from './AgentExecutionJournalSchema.js';
import { projectAgentExecutionObservationSignalToChatMessage } from './AgentExecutionSignalRegistry.js';

export type AgentExecutionJournalReplayState = {
    chatMessages: AgentExecutionChatMessageType[];
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
    const chatMessages: AgentExecutionChatMessageType[] = [];
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
                appendUniqueChatMessage(chatMessages, toChatMessageFromAcceptedMessage(record));
                break;
            case 'observation.recorded':
                processedObservationIds.add(record.observationId);
                appendUniqueChatMessage(chatMessages, toChatMessageFromObservation(record));
                break;
            case 'state.changed':
                lifecycleState = record.lifecycle ?? lifecycleState;
                attention = record.attention ?? attention;
                semanticActivity = record.activity ?? semanticActivity;
                if (record.currentInputRequestId !== undefined) {
                    currentInputRequestId = record.currentInputRequestId;
                }
                break;
            case 'activity.updated':
                runtimeActivity = mergeRuntimeActivity(runtimeActivity, record);
                telemetry = mergeTelemetry(telemetry, record);
                break;
            default:
                break;
        }
    }

    return {
        chatMessages,
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
        chatMessages: replay.chatMessages,
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

function toChatMessageFromAcceptedMessage(record: Extract<AgentExecutionJournalRecordType, { type: 'message.accepted' }>): AgentExecutionChatMessageType | undefined {
    const text = readMessageText(record.payload);
    if (!text) {
        return undefined;
    }
    if (record.source === 'operator') {
        return AgentExecutionChatMessageSchema.parse({
            id: record.messageId,
            role: 'operator',
            kind: 'message',
            tone: 'neutral',
            text,
            at: record.occurredAt
        });
    }
    return AgentExecutionChatMessageSchema.parse({
        id: record.messageId,
        role: 'system',
        kind: 'message',
        tone: 'neutral',
        text,
        at: record.occurredAt
    });
}

function toChatMessageFromObservation(record: AgentExecutionObservationRecordType): AgentExecutionChatMessageType | undefined {
    const signal = record.signal;
    if (!signal) {
        return undefined;
    }

    return projectAgentExecutionObservationSignalToChatMessage({
        observationId: record.observationId,
        occurredAt: record.occurredAt,
        signal
    });
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

function appendUniqueChatMessage(chatMessages: AgentExecutionChatMessageType[], message: AgentExecutionChatMessageType | undefined): void {
    if (!message || chatMessages.some((existing) => existing.id === message.id)) {
        return;
    }
    chatMessages.push(message);
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