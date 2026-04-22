import type {
    MissionGateProjection,
    MissionStageId,
    MissionStageRuntimeProjection,
    MissionTaskLifecycleState,
    MissionTaskRuntimeState,
    MissionWorkflowConfigurationSnapshot,
    MissionWorkflowRuntimeState
} from './types.js';
import {
    isStageCompletedFromTasks,
    isTerminalTaskLifecycle,
    resolveEligibleStageId
} from './policy.js';

export interface MissionWorkflowDerivedProjectionState {
    activeStageId?: MissionStageId;
    tasks: MissionTaskRuntimeState[];
    stages: MissionStageRuntimeProjection[];
    gates: MissionGateProjection[];
}

export function deriveMissionWorkflowProjectionState(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot,
    updatedAt: string
): MissionWorkflowDerivedProjectionState {
    const activeStageId = resolveEligibleStageId(runtime, configuration);
    const tasks = deriveTaskRuntimeStates(runtime.tasks, activeStageId);
    const stages = buildStageProjections(tasks, configuration, activeStageId);
    const gates = buildGateProjections(stages, configuration, updatedAt);
    return {
        ...(activeStageId ? { activeStageId } : {}),
        tasks,
        stages,
        gates
    };
}

function deriveTaskRuntimeStates(
    tasks: MissionTaskRuntimeState[],
    activeStageId: MissionStageId | undefined
): MissionTaskRuntimeState[] {
    const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
    return tasks.map((task) => {
        const waitingOnTaskIds = task.dependsOn.filter((dependencyTaskId) => tasksById.get(dependencyTaskId)?.lifecycle !== 'completed');
        const stageEligible = task.stageId === activeStageId;
        let lifecycle: MissionTaskLifecycleState = task.lifecycle;

        if (isTerminalTaskLifecycle(lifecycle) || lifecycle === 'queued' || lifecycle === 'running') {
            return {
                ...task,
                waitingOnTaskIds,
                updatedAt: task.updatedAt
            };
        }

        if (!stageEligible) {
            lifecycle = 'pending';
        } else if (waitingOnTaskIds.length > 0) {
            lifecycle = 'pending';
        } else {
            lifecycle = 'ready';
        }

        return {
            ...task,
            lifecycle,
            waitingOnTaskIds,
            updatedAt: task.updatedAt
        };
    });
}

function buildStageProjections(
    tasks: MissionTaskRuntimeState[],
    configuration: MissionWorkflowConfigurationSnapshot,
    activeStageId: MissionStageId | undefined
): MissionStageRuntimeProjection[] {
    return configuration.workflow.stageOrder.map((stageId) => {
        const stageTasks = tasks.filter((task) => task.stageId === stageId);
        const readyTaskIds = stageTasks.filter((task) => task.lifecycle === 'ready').map((task) => task.taskId);
        const queuedTaskIds = stageTasks.filter((task) => task.lifecycle === 'queued').map((task) => task.taskId);
        const runningTaskIds = stageTasks.filter((task) => task.lifecycle === 'running').map((task) => task.taskId);
        const completedTaskIds = stageTasks.filter((task) => task.lifecycle === 'completed').map((task) => task.taskId);
        const completed = isStageCompletedFromTasks(tasks, stageId, configuration);
        const eligible = stageId === activeStageId || completed;
        let lifecycle: MissionStageRuntimeProjection['lifecycle'] = 'pending';

        if (completed) {
            lifecycle = 'completed';
        } else if (!eligible) {
            lifecycle = 'pending';
        } else if (queuedTaskIds.length > 0 || runningTaskIds.length > 0) {
            lifecycle = 'active';
        } else if (readyTaskIds.length > 0) {
            lifecycle = 'ready';
        } else {
            lifecycle = 'pending';
        }

        return {
            stageId,
            lifecycle,
            taskIds: stageTasks.map((task) => task.taskId),
            readyTaskIds,
            queuedTaskIds,
            runningTaskIds,
            completedTaskIds
        };
    });
}

function buildGateProjections(
    stages: MissionStageRuntimeProjection[],
    configuration: MissionWorkflowConfigurationSnapshot,
    updatedAt: string
): MissionGateProjection[] {
    return configuration.workflow.gates.map((gate) => {
        if (!gate.stageId) {
            return {
                gateId: gate.gateId,
                intent: gate.intent,
                state: 'blocked',
                reasons: ['Gate is not bound to a stage.'],
                updatedAt
            };
        }
        const stage = stages.find((candidate) => candidate.stageId === gate.stageId);
        const passed = stage?.lifecycle === 'completed';
        return {
            gateId: gate.gateId,
            intent: gate.intent,
            state: passed ? 'passed' : 'blocked',
            stageId: gate.stageId,
            reasons: passed ? [] : [`Stage '${gate.stageId}' is not completed.`],
            updatedAt
        };
    });
}