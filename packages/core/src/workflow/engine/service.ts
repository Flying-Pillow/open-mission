import {
    createInitialMissionWorkflowRuntimeState,
    reduceMissionWorkflowEvent,
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowEventRecord,
    type MissionWorkflowRequest,
    type MissionRuntimeRecord,
    type MissionWorkflowSignal
} from './index.js';
import { ensureMissionWorkflowEventAccepted } from './validation.js';

export interface MissionWorkflowIngestResult {
    document: MissionRuntimeRecord;
    signals: MissionWorkflowSignal[];
    requests: MissionWorkflowRequest[];
}

export function ingestMissionWorkflowEvent(
    document: MissionRuntimeRecord,
    event: MissionWorkflowEvent
): MissionWorkflowIngestResult {
    ensureMissionWorkflowEventAccepted(document, event);
    const reduction = reduceMissionWorkflowEvent(document.runtime, event, document.configuration);
    const nextDocument: MissionRuntimeRecord = {
        ...document,
        runtime: reduction.nextState,
        eventLog: [...document.eventLog, toEventRecord(event)]
    };
    return {
        document: nextDocument,
        signals: reduction.signals,
        requests: reduction.requests
    };
}

export function createMissionRuntimeRecordForMission(input: {
    missionId: string;
    configuration: MissionWorkflowConfigurationSnapshot;
    createdAt?: string;
}): MissionRuntimeRecord {
    const createdAt = input.createdAt ?? input.configuration.createdAt;
    return {
        schemaVersion: 1,
        missionId: input.missionId,
        configuration: input.configuration,
        runtime: createInitialMissionWorkflowRuntimeState(input.configuration, createdAt),
        eventLog: []
    };
}

function toEventRecord(event: MissionWorkflowEvent): MissionWorkflowEventRecord {
    const payloadEntries = Object.entries(event).filter(([key]) =>
        key !== 'eventId' && key !== 'type' && key !== 'occurredAt' && key !== 'source' && key !== 'causedByRequestId'
    );
    return {
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        source: event.source,
        ...(event.causedByRequestId ? { causedByRequestId: event.causedByRequestId } : {}),
        payload: Object.fromEntries(payloadEntries)
    };
}
