import {
    WORKFLOW_RUNTIME_SCHEMA_VERSION,
    type AgentExecutionRuntimeState,
    type MissionStageId,
    type WorkflowConfigurationSnapshot,
    type WorkflowEvent,
    type WorkflowEventRecord,
    type WorkflowRequest,
    type WorkflowStateData,
    type WorkflowSignal,
    type WorkflowRuntimeState,
    type WorkflowDefinition
} from './types.js';
import { reduceWorkflowEvent } from './reducer.js';
import { ensureWorkflowEventAccepted } from './validation.js';

export interface WorkflowIngestResult {
    document: WorkflowStateData;
    eventRecord: WorkflowEventRecord;
    signals: WorkflowSignal[];
    requests: WorkflowRequest[];
}

export function createWorkflowConfigurationSnapshot(input: {
    createdAt?: string;
    workflowVersion: string;
    workflow: WorkflowDefinition;
}): WorkflowConfigurationSnapshot {
    return {
        createdAt: input.createdAt ?? new Date().toISOString(),
        source: 'workflow-definition',
        workflowVersion: input.workflowVersion,
        workflow: structuredClone(input.workflow)
    };
}

export function createDraftWorkflowRuntimeState(
    configuration: WorkflowConfigurationSnapshot,
    createdAt = new Date().toISOString()
): WorkflowRuntimeState {
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
        agentExecutions: [],
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

export function createInitialWorkflowRuntimeState(
    configuration: WorkflowConfigurationSnapshot,
    createdAt = new Date().toISOString()
): WorkflowRuntimeState {
    return createDraftWorkflowRuntimeState(configuration, createdAt);
}

export function createWorkflowStateData(input: {
    missionId: string;
    configuration: WorkflowConfigurationSnapshot;
    runtime?: WorkflowRuntimeState;
    createdAt?: string;
}): WorkflowStateData {
    const createdAt = input.createdAt ?? input.configuration.createdAt;
    return {
        schemaVersion: WORKFLOW_RUNTIME_SCHEMA_VERSION,
        missionId: input.missionId,
        configuration: input.configuration,
        runtime:
            input.runtime ??
            createInitialWorkflowRuntimeState(input.configuration, createdAt)
    };
}

export function ingestWorkflowEvent(
    document: WorkflowStateData,
    event: WorkflowEvent
): WorkflowIngestResult {
    ensureWorkflowEventAccepted(document, event);
    const reduction = reduceWorkflowEvent(document.runtime, event, document.configuration);
    const nextDocument: WorkflowStateData = {
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

export function toAgentExecutionRuntimeState(
    execution: AgentExecutionRuntimeState
): AgentExecutionRuntimeState {
    return {
        agentExecutionId: execution.agentExecutionId,
        taskId: execution.taskId,
        agentId: execution.agentId,
        ...(execution.transportId ? { transportId: execution.transportId } : {}),
        ...(execution.agentJournalPath ? { agentJournalPath: execution.agentJournalPath } : {}),
        ...(execution.terminalRecordingPath ? { terminalRecordingPath: execution.terminalRecordingPath } : {}),
        ...(execution.terminalHandle ? { terminalHandle: { ...execution.terminalHandle } } : {}),
        lifecycle: execution.lifecycle,
        launchedAt: execution.launchedAt,
        updatedAt: execution.updatedAt,
        ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
        ...(execution.failedAt ? { failedAt: execution.failedAt } : {}),
        ...(execution.cancelledAt ? { cancelledAt: execution.cancelledAt } : {}),
        ...(execution.terminatedAt ? { terminatedAt: execution.terminatedAt } : {})
    };
}

function toEventRecord(event: WorkflowEvent): WorkflowEventRecord {
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
