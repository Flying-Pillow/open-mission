import type {
    AgentExecutionObservation,
    AgentExecutionSignalDecision
} from '../AgentExecutionSchema.js';
import { projectAgentExecutionObservationSignalToTimelineItem } from '../observations/AgentExecutionObservationSignalRegistry.js';
import type { AgentExecutionTimelineItemType } from '../activity/AgentExecutionActivityTimelineSchema.js';

export function createActivityItemFromAgentExecutionObservation(input: {
    observation: AgentExecutionObservation;
    decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>;
}): AgentExecutionTimelineItemType | undefined {
    const signal = input.observation.signal;
    if (
        signal.type === 'diagnostic'
        || signal.type === 'usage'
        || signal.type === 'message'
        || input.decision.action === 'emit-message'
    ) {
        return undefined;
    }

    return projectAgentExecutionObservationSignalToTimelineItem({
        itemId: input.observation.observationId,
        occurredAt: input.observation.observedAt,
        signal,
        provenance: {
            durable: false,
            sourceRecordIds: [],
            liveOverlay: true,
            confidence: signal.confidence
        }
    });
}
