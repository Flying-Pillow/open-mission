import {
    MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION,
    type MissionAgentSessionRuntimeState,
    type MissionStageId,
    type MissionWorkflowConfigurationSnapshot,
    type MissionRuntimeRecord,
    type MissionWorkflowRuntimeState,
    type WorkflowGlobalSettings
} from './types.js';

export function createMissionWorkflowConfigurationSnapshot(input: {
    createdAt?: string;
    workflowVersion: string;
    workflow: WorkflowGlobalSettings;
}): MissionWorkflowConfigurationSnapshot {
    return {
        createdAt: input.createdAt ?? new Date().toISOString(),
        source: 'global-settings',
        workflowVersion: input.workflowVersion,
        workflow: input.workflow
    };
}

export function createDraftMissionWorkflowRuntimeState(
    configuration: MissionWorkflowConfigurationSnapshot,
    createdAt = new Date().toISOString()
): MissionWorkflowRuntimeState {
    return {
        lifecycle: 'draft',
        pause: {
            paused: false
        },
        panic: {
            active: false,
            terminateSessions: configuration.workflow.panic.terminateSessions,
            clearLaunchQueue: configuration.workflow.panic.clearLaunchQueue,
            haltMission: configuration.workflow.panic.haltMission
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

export function createMissionRuntimeRecord(input: {
    missionId: string;
    configuration: MissionWorkflowConfigurationSnapshot;
    runtime?: MissionWorkflowRuntimeState;
    eventLog?: MissionRuntimeRecord['eventLog'];
    createdAt?: string;
}): MissionRuntimeRecord {
    const createdAt = input.createdAt ?? input.configuration.createdAt;
    return {
        schemaVersion: MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION,
        missionId: input.missionId,
        configuration: input.configuration,
        runtime:
            input.runtime ??
            createInitialMissionWorkflowRuntimeState(input.configuration, createdAt),
        eventLog: input.eventLog ?? []
    };
}

export function toMissionAgentSessionRuntimeState(
    session: MissionAgentSessionRuntimeState
): MissionAgentSessionRuntimeState {
    return {
        sessionId: session.sessionId,
        taskId: session.taskId,
        runtimeId: session.runtimeId,
        lifecycle: session.lifecycle,
        launchedAt: session.launchedAt,
        updatedAt: session.updatedAt,
        ...(session.completedAt ? { completedAt: session.completedAt } : {}),
        ...(session.failedAt ? { failedAt: session.failedAt } : {}),
        ...(session.cancelledAt ? { cancelledAt: session.cancelledAt } : {}),
        ...(session.terminatedAt ? { terminatedAt: session.terminatedAt } : {})
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
        blockedTaskIds: [],
        completedTaskIds: []
    };
}
