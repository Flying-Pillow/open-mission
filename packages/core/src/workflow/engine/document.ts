import {
    MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION,
    type AgentSessionRuntimeState,
    type MissionStageId,
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowEventRecord,
    type MissionWorkflowRequest,
    type MissionStateData,
    type MissionWorkflowSignal,
    type MissionWorkflowRuntimeState,
    type WorkflowDefinition
} from './types.js';
import { reduceMissionWorkflowEvent } from './reducer.js';
import { ensureMissionWorkflowEventAccepted } from './validation.js';

export interface MissionWorkflowIngestResult {
    document: MissionStateData;
    eventRecord: MissionWorkflowEventRecord;
    signals: MissionWorkflowSignal[];
    requests: MissionWorkflowRequest[];
}

export function createMissionWorkflowConfigurationSnapshot(input: {
    createdAt?: string;
    workflowVersion: string;
    workflow: WorkflowDefinition;
}): MissionWorkflowConfigurationSnapshot {
    return {
        createdAt: input.createdAt ?? new Date().toISOString(),
        source: 'workflow-definition',
        workflowVersion: input.workflowVersion,
        workflow: structuredClone(input.workflow)
    };
}

export function createDraftMissionWorkflowRuntimeState(
    configuration: MissionWorkflowConfigurationSnapshot,
    createdAt = new Date().toISOString()
): MissionWorkflowRuntimeState {
    const activeStageId = configuration.workflow.stageOrder[0];
    return {
        lifecycle: 'draft',
        ...(activeStageId ? { activeStageId } : {}),
        pause: {
            paused: false
        },
        stages: configuration.workflow.stageOrder.map((stageId, index) =>
            createEmptyStageProjection(stageId, index === 0 ? 'ready' : 'pending')
        ),
        tasks: [],
        sessions: [],
        gates: configuration.workflow.gates.map((gate) => ({
            gateId: gate.gateId,
            intent: gate.intent,
            state: 'blocked',
            ...(gate.stageId ? { stageId: gate.stageId } : {}),
            reasons: gate.stageId ? [`Stage '${gate.stageId}' is not completed.`] : ['Gate is blocked.'],
            updatedAt: createdAt
        })),
        launchQueue: [],
        updatedAt: createdAt
    };
}

export function createInitialMissionWorkflowRuntimeState(
    configuration: MissionWorkflowConfigurationSnapshot,
    createdAt = new Date().toISOString()
): MissionWorkflowRuntimeState {
    return createDraftMissionWorkflowRuntimeState(configuration, createdAt);
}

export function createMissionStateData(input: {
    missionId: string;
    configuration: MissionWorkflowConfigurationSnapshot;
    runtime?: MissionWorkflowRuntimeState;
    createdAt?: string;
}): MissionStateData {
    const createdAt = input.createdAt ?? input.configuration.createdAt;
    return {
        schemaVersion: MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION,
        missionId: input.missionId,
        configuration: input.configuration,
        runtime:
            input.runtime ??
            createInitialMissionWorkflowRuntimeState(input.configuration, createdAt)
    };
}

export function ingestMissionWorkflowEvent(
    document: MissionStateData,
    event: MissionWorkflowEvent
): MissionWorkflowIngestResult {
    ensureMissionWorkflowEventAccepted(document, event);
    const reduction = reduceMissionWorkflowEvent(document.runtime, event, document.configuration);
    const nextDocument: MissionStateData = {
        ...document,
        runtime: reduction.nextState
    };
    return {
        document: nextDocument,
        eventRecord: toEventRecord(event),
        signals: reduction.signals,
        requests: reduction.requests
    };
}

export function toAgentSessionRuntimeState(
    session: AgentSessionRuntimeState
): AgentSessionRuntimeState {
    return {
        sessionId: session.sessionId,
        taskId: session.taskId,
        runnerId: session.runnerId,
        ...(session.transportId ? { transportId: session.transportId } : {}),
        ...(session.sessionLogPath ? { sessionLogPath: session.sessionLogPath } : {}),
        ...(session.terminalHandle ? { terminalHandle: { ...session.terminalHandle } } : {}),
        lifecycle: session.lifecycle,
        launchedAt: session.launchedAt,
        updatedAt: session.updatedAt,
        ...(session.completedAt ? { completedAt: session.completedAt } : {}),
        ...(session.failedAt ? { failedAt: session.failedAt } : {}),
        ...(session.cancelledAt ? { cancelledAt: session.cancelledAt } : {}),
        ...(session.terminatedAt ? { terminatedAt: session.terminatedAt } : {})
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

function createEmptyStageProjection(stageId: MissionStageId, lifecycle: 'pending' | 'ready') {
    return {
        stageId,
        lifecycle,
        taskIds: [],
        readyTaskIds: [],
        queuedTaskIds: [],
        runningTaskIds: [],
        completedTaskIds: []
    };
}
