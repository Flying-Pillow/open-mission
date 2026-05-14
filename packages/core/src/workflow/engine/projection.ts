import type {
    WorkflowGateTimeline,
    MissionStageId,
    WorkflowStageRuntimeTimeline,
    WorkflowTaskLifecycleState,
    WorkflowTaskRuntimeState,
    WorkflowConfigurationSnapshot,
    WorkflowRuntimeState
} from './types.js';
import {
    isStageCompletedFromTasks,
    isTerminalTaskLifecycle,
    resolveEligibleStageId
} from './policy.js';

export interface WorkflowDerivedTimelineState {
    activeStageId?: MissionStageId;
    tasks: WorkflowTaskRuntimeState[];
    stages: WorkflowStageRuntimeTimeline[];
    gates: WorkflowGateTimeline[];
}

export function deriveWorkflowTimelineState(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot,
    updatedAt: string
): WorkflowDerivedTimelineState {
    const activeStageId = resolveEligibleStageId(runtime, configuration);
    const tasks = deriveTaskRuntimeStates(runtime.tasks, activeStageId);
    const stages = buildStageTimelines(tasks, configuration, activeStageId);
    const gates = buildGateTimelines(stages, configuration, updatedAt);
    return {
        ...(activeStageId ? { activeStageId } : {}),
        tasks,
        stages,
        gates
    };
}

function deriveTaskRuntimeStates(
    tasks: WorkflowTaskRuntimeState[],
    activeStageId: MissionStageId | undefined
): WorkflowTaskRuntimeState[] {
    const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
    return tasks.map((task) => {
        const waitingOnTaskIds = task.dependsOn.filter((dependencyTaskId) => tasksById.get(dependencyTaskId)?.lifecycle !== 'completed');
        const stageEligible = task.stageId === activeStageId;
        let lifecycle: WorkflowTaskLifecycleState = task.lifecycle;

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

function buildStageTimelines(
    tasks: WorkflowTaskRuntimeState[],
    configuration: WorkflowConfigurationSnapshot,
    activeStageId: MissionStageId | undefined
): WorkflowStageRuntimeTimeline[] {
    return configuration.workflow.stageOrder.map((stageId) => {
        const stageTasks = tasks.filter((task) => task.stageId === stageId);
        const readyTaskIds = stageTasks.filter((task) => task.lifecycle === 'ready').map((task) => task.taskId);
        const queuedTaskIds = stageTasks.filter((task) => task.lifecycle === 'queued').map((task) => task.taskId);
        const runningTaskIds = stageTasks.filter((task) => task.lifecycle === 'running').map((task) => task.taskId);
        const completedTaskIds = stageTasks.filter((task) => task.lifecycle === 'completed').map((task) => task.taskId);
        const completed = isStageCompletedFromTasks(tasks, stageId, configuration);
        const eligible = stageId === activeStageId || completed;
        let lifecycle: WorkflowStageRuntimeTimeline['lifecycle'] = 'pending';

        if (completed) {
            lifecycle = 'completed';
        } else if (!eligible) {
            lifecycle = 'pending';
        } else if (queuedTaskIds.length > 0 || runningTaskIds.length > 0) {
            lifecycle = 'running';
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

function buildGateTimelines(
    stages: WorkflowStageRuntimeTimeline[],
    configuration: WorkflowConfigurationSnapshot,
    updatedAt: string
): WorkflowGateTimeline[] {
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