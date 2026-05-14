import { createEntityIdentitySegment } from '../../Entity/Entity.js';
import { AgentExecutionSchema, type AgentExecutionEvent, type AgentExecutionProcess, type AgentExecutionType } from '../AgentExecutionSchema.js';
import {
    AgentExecutionTimelineItemSchema,
    AgentExecutionTimelineSchema,
    type AgentExecutionTimelineActivityType,
    type AgentExecutionTimelineAttentionType,
    type AgentExecutionTimelineItemType,
    type AgentExecutionTimelineType
} from '../activity/AgentExecutionActivityTimelineSchema.js';
import { cloneAgentExecutionProcess } from '../process/AgentExecutionProcessState.js';
import {
    createAgentExecutionLiveActivity,
    deriveAgentExecutionActivityFromProcess
} from './AgentExecutionActivity.js';
import {
    resolveAgentExecutionInputCapabilities,
    resolveAgentExecutionSupportedMessages
} from '../input/AgentExecutionInput.js';

export function cloneAgentExecutionTimeline(timeline: AgentExecutionTimelineType): AgentExecutionTimelineType {
    return AgentExecutionTimelineSchema.parse(cloneStructured(timeline));
}

export function createActivityItemFromAgentExecutionEvent(event: AgentExecutionEvent): AgentExecutionTimelineItemType | undefined {
    if (event.type === 'execution.message' && event.channel === 'agent') {
        if (event.timelineItem) {
            return event.timelineItem;
        }
        return {
            id: createAgentExecutionTimelineItemId(event.execution.agentExecutionId, event.execution.updatedAt, event.channel, event.text),
            occurredAt: event.execution.updatedAt,
            zone: 'conversation',
            primitive: 'conversation.agent-message',
            behavior: createTimelineBehavior('conversational'),
            provenance: {
                durable: false,
                sourceRecordIds: [],
                liveOverlay: true,
                confidence: 'medium'
            },
            payload: {
                text: event.text
            }
        };
    }
    if (event.type === 'execution.completed' && event.execution.progress.summary) {
        return {
            id: createAgentExecutionTimelineItemId(event.execution.agentExecutionId, event.execution.updatedAt, 'completed'),
            occurredAt: event.execution.updatedAt,
            zone: 'workflow',
            primitive: 'attention.verification-result',
            behavior: createTimelineBehavior('approval'),
            severity: 'success',
            provenance: {
                durable: false,
                sourceRecordIds: [],
                liveOverlay: true,
                confidence: 'high'
            },
            payload: {
                title: 'Completed',
                text: event.execution.progress.summary,
                result: 'passed'
            }
        };
    }
    if (event.type === 'execution.failed') {
        return {
            id: createAgentExecutionTimelineItemId(event.execution.agentExecutionId, event.execution.updatedAt, 'failed'),
            occurredAt: event.execution.updatedAt,
            zone: 'workflow',
            primitive: 'attention.verification-result',
            behavior: createTimelineBehavior('approval', { sticky: true }),
            severity: 'error',
            provenance: {
                durable: false,
                sourceRecordIds: [],
                liveOverlay: true,
                confidence: 'high'
            },
            payload: {
                title: 'Failed',
                text: event.reason,
                result: 'failed'
            }
        };
    }
    return undefined;
}

export function appendAgentExecutionActivityItem(input: {
    timeline: AgentExecutionTimelineType;
    item: AgentExecutionTimelineItemType | undefined;
}): { appended: boolean; timeline: AgentExecutionTimelineType; occurredAt?: string } {
    if (!input.item) {
        return { appended: false, timeline: input.timeline };
    }
    const parsed = AgentExecutionTimelineItemSchema.parse(input.item);
    if (input.timeline.timelineItems.some((existing) => existing.id === parsed.id)) {
        return { appended: false, timeline: input.timeline };
    }
    return {
        appended: true,
        occurredAt: parsed.occurredAt,
        timeline: AgentExecutionTimelineSchema.parse({
            ...input.timeline,
            timelineItems: [...input.timeline.timelineItems, parsed]
        })
    };
}

export function refreshAgentExecutionActivityTimeline(input: {
    execution: AgentExecutionType;
    process?: AgentExecutionProcess | undefined;
    timeline: AgentExecutionTimelineType;
    updatedAt: string;
}): { execution: AgentExecutionType; timeline: AgentExecutionTimelineType } {
    const process = input.process;
    const lifecycleState = process?.status ?? input.execution.lifecycleState;
    const attention = process?.attention ?? input.execution.attention;
    const activityState = deriveAgentExecutionActivityFromProcess({
        process,
        fallbackActivity: input.execution.activityState,
        awaitingResponseToMessageId: input.execution.awaitingResponseToMessageId
    });
    const liveActivity = process?.progress
        ? createAgentExecutionLiveActivity(process.progress)
        : input.execution.liveActivity;
    const currentActivity = createCurrentActivityTimeline({
        lifecycleState,
        attention,
        activityState,
        liveActivity,
        telemetry: input.execution.telemetry,
        updatedAt: process?.updatedAt ?? input.updatedAt
    });
    const currentAttention = createCurrentAttentionTimeline({
        attention,
        currentInputRequestId: process?.currentInputRequestId ?? input.execution.currentInputRequestId,
        timelineItems: input.timeline.timelineItems,
        updatedAt: process?.updatedAt ?? input.updatedAt
    });
    const timeline = AgentExecutionTimelineSchema.parse({
        timelineItems: [...input.timeline.timelineItems],
        ...(currentActivity ? { currentActivity } : {}),
        ...(currentAttention ? { currentAttention } : {}),
        ...(input.timeline.liveOverlay
            ? { liveOverlay: cloneStructured(input.timeline.liveOverlay) }
            : {})
    });
    const execution = AgentExecutionSchema.parse({
        ...input.execution,
        ...(process ? { process: cloneAgentExecutionProcess(process) } : {}),
        lifecycleState,
        ...(attention !== undefined ? { attention } : {}),
        ...(activityState ? { activityState } : {}),
        ...(input.execution.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: input.execution.awaitingResponseToMessageId } : {}),
        ...(liveActivity ? { liveActivity: cloneStructured(liveActivity) } : {}),
        ...(process?.failureMessage ? { failureMessage: process.failureMessage } : {}),
        ...(process
            ? {
                interactionCapabilities: process.interactionCapabilities
                    ? { ...process.interactionCapabilities }
                    : resolveAgentExecutionInputCapabilities({
                        lifecycleState: process.status,
                        ...(process.transport ? { transport: process.transport } : {}),
                        acceptsPrompts: process.acceptsPrompts,
                        acceptedCommands: process.acceptedCommands
                    }),
                supportedMessages: resolveAgentExecutionSupportedMessages({
                    lifecycleState: process.status,
                    acceptsPrompts: process.acceptsPrompts,
                    acceptedCommands: process.acceptedCommands
                })
            }
            : {}),
        timeline: cloneAgentExecutionTimeline(timeline),
        lastUpdatedAt: process?.updatedAt ?? input.updatedAt
    });
    return { execution, timeline };
}

export function createAgentExecutionTimelineItemId(agentExecutionId: string, at: string, kind: string, text = ''): string {
    const normalizedText = createEntityIdentitySegment(text).slice(0, 32);
    return [agentExecutionId, at, kind, normalizedText].filter(Boolean).join(':');
}

export function createTimelineBehavior(
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
    lifecycleState: AgentExecutionType['lifecycleState'];
    attention: AgentExecutionType['attention'] | undefined;
    activityState: AgentExecutionType['activityState'] | undefined;
    liveActivity: AgentExecutionType['liveActivity'] | undefined;
    telemetry: AgentExecutionType['telemetry'] | undefined;
    updatedAt: string;
}): AgentExecutionTimelineActivityType | undefined {
    if (
        !input.lifecycleState
        && !input.attention
        && !input.activityState
        && !input.liveActivity
        && !input.telemetry
    ) {
        return undefined;
    }
    return {
        updatedAt: input.updatedAt,
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

function createCurrentAttentionTimeline(input: {
    attention: AgentExecutionType['attention'] | undefined;
    currentInputRequestId: AgentExecutionType['currentInputRequestId'] | undefined;
    timelineItems: AgentExecutionTimelineItemType[];
    updatedAt: string;
}): AgentExecutionTimelineAttentionType | undefined {
    if (!input.attention || input.attention === 'none' || input.attention === 'autonomous') {
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
            updatedAt: input.updatedAt
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
        updatedAt: attentionItem?.occurredAt ?? input.updatedAt
    };
}

function resolveCurrentAttentionTimelineItem(
    timelineItems: AgentExecutionTimelineItemType[],
    currentInputRequestId: AgentExecutionType['currentInputRequestId'] | undefined
): AgentExecutionTimelineItemType | undefined {
    if (currentInputRequestId) {
        const inputRequestItem = timelineItems.find((item) => item.id === currentInputRequestId);
        if (inputRequestItem?.primitive === 'attention.input-request') {
            return inputRequestItem;
        }
    }
    return [...timelineItems].reverse().find(
        (item) => item.primitive.startsWith('attention.') && item.primitive !== 'attention.input-request'
    );
}

function cloneStructured<T>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
}
