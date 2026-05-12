import type {
    WorkflowTaskPendingLaunchContext,
    AgentExecutionLifecycleState,
    MissionStageId,
    WorkflowTaskLifecycleState,
    WorkflowTaskRuntimeState,
    WorkflowConfigurationSnapshot,
    WorkflowRequest,
    WorkflowRuntimeState
} from './types.js';
import { DEFAULT_TASK_MAX_REWORK_ITERATIONS } from './types.js';

export function isActiveAgentExecutionLifecycle(lifecycle: AgentExecutionLifecycleState): boolean {
    return lifecycle === 'starting' || lifecycle === 'running';
}

export function isTerminalTaskLifecycle(lifecycle: WorkflowTaskLifecycleState): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

export function isReopenableTaskLifecycle(lifecycle: WorkflowTaskLifecycleState): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

export function resolveTaskMaxReworkIterations(task: WorkflowTaskRuntimeState): number {
    return task.runtime.maxReworkIterations ?? DEFAULT_TASK_MAX_REWORK_ITERATIONS;
}

export function buildReworkPendingLaunchContext(task: WorkflowTaskRuntimeState): WorkflowTaskPendingLaunchContext | undefined {
    if (!task.reworkRequest) {
        return undefined;
    }

    return {
        source: 'rework',
        requestId: task.reworkRequest.requestId,
        createdAt: task.reworkRequest.requestedAt,
        actor: task.reworkRequest.actor,
        reasonCode: task.reworkRequest.reasonCode,
        summary: task.reworkRequest.summary,
        ...(task.reworkRequest.sourceTaskId ? { sourceTaskId: task.reworkRequest.sourceTaskId } : {}),
        artifactRefs: task.reworkRequest.artifactRefs.map((artifactRef) => ({ ...artifactRef }))
    };
}

export function resolveEligibleStageId(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot
): MissionStageId | undefined {
    for (const stageId of configuration.workflow.stageOrder) {
        if (!isStageCompletedFromTasks(runtime.tasks, stageId, configuration)) {
            return stageId;
        }
    }
    return undefined;
}

export function isStageCompletedFromTasks(
    tasks: WorkflowTaskRuntimeState[],
    stageId: MissionStageId,
    configuration: WorkflowConfigurationSnapshot
): boolean {
    const stageTasks = tasks.filter((task) => task.stageId === stageId);
    return (
        (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
        isImplicitlyCompletedEmptyFinalStageFromTasks(tasks, stageId, stageTasks, configuration)
    );
}

export function isStageCompleted(
    runtime: WorkflowRuntimeState,
    stageId: MissionStageId,
    configuration: WorkflowConfigurationSnapshot
): boolean {
    return isStageCompletedFromTasks(runtime.tasks, stageId, configuration);
}

export function isImplicitlyCompletedEmptyFinalStageFromTasks(
    tasks: WorkflowTaskRuntimeState[],
    stageId: MissionStageId,
    stageTasks: WorkflowTaskRuntimeState[],
    configuration: WorkflowConfigurationSnapshot
): boolean {
    if (stageTasks.length > 0) {
        return false;
    }

    const finalStageId = configuration.workflow.stageOrder[configuration.workflow.stageOrder.length - 1];
    if (stageId !== finalStageId) {
        return false;
    }

    const stageIndex = configuration.workflow.stageOrder.indexOf(stageId);
    const priorStagesComplete = configuration.workflow.stageOrder
        .slice(0, stageIndex)
        .every((priorStageId) => {
            const priorStageTasks = tasks.filter((task) => task.stageId === priorStageId);
            return priorStageTasks.length > 0 && priorStageTasks.every((task) => task.lifecycle === 'completed');
        });
    if (!priorStagesComplete) {
        return false;
    }

    const generationRule = configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === stageId);
    if (!generationRule) {
        return true;
    }

    return generationRule.templateSources.length === 0 && generationRule.tasks.length === 0;
}

export function isImplicitlyCompletedEmptyFinalStage(
    runtime: WorkflowRuntimeState,
    stageId: MissionStageId,
    stageTasks: WorkflowTaskRuntimeState[],
    configuration: WorkflowConfigurationSnapshot
): boolean {
    return isImplicitlyCompletedEmptyFinalStageFromTasks(runtime.tasks, stageId, stageTasks, configuration);
}

export function resolvePendingTaskGenerationStageId(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot
): MissionStageId | undefined {
    const eligibleStageId = resolveEligibleStageId(runtime, configuration);
    if (!eligibleStageId) {
        return undefined;
    }

    if (runtime.tasks.some((task) => task.stageId === eligibleStageId)) {
        return undefined;
    }

    const generationRule = configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === eligibleStageId);
    if (!generationRule) {
        return undefined;
    }

    return generationRule.artifactTasks === false
        && generationRule.templateSources.length === 0
        && generationRule.tasks.length === 0
        ? undefined
        : eligibleStageId;
}

export function buildWorkflowTaskGenerationRequests(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot,
    issuedAt: string
): WorkflowRequest[] {
    const stageId = resolvePendingTaskGenerationStageId(runtime, configuration);
    if (!stageId) {
        return [];
    }

    return [{
        requestId: `tasks.request-generation:${issuedAt}`,
        type: 'tasks.request-generation',
        payload: { stageId }
    }];
}

export function countOccupiedTaskExecutionSlots(runtime: WorkflowRuntimeState): number {
    return runtime.tasks.filter((task) => task.lifecycle === 'queued' || task.lifecycle === 'running').length;
}

export function countOccupiedAgentExecutionSlots(runtime: WorkflowRuntimeState): number {
    const activeAgentExecutions = runtime.agentExecutions.filter((execution) => isActiveAgentExecutionLifecycle(execution.lifecycle)).length;
    const dispatchedLaunches = runtime.launchQueue.filter((request) =>
        Boolean(request.dispatchedAt) &&
        !runtime.agentExecutions.some((execution) =>
            execution.taskId === request.taskId && isActiveAgentExecutionLifecycle(execution.lifecycle)
        )
    ).length;
    return activeAgentExecutions + dispatchedLaunches;
}

export function hasAvailableTaskExecutionSlot(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot
): boolean {
    return countOccupiedTaskExecutionSlots(runtime) < configuration.workflow.execution.maxParallelTasks;
}

export function hasAvailableAgentExecutionSlot(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot
): boolean {
    return countOccupiedAgentExecutionSlots(runtime) < configuration.workflow.execution.maxParallelAgentExecutions;
}

export function resolveDependentTaskIds(
    tasks: WorkflowTaskRuntimeState[],
    taskId: string
): Set<string> {
    const dependentsByTaskId = new Map<string, string[]>();

    for (const task of tasks) {
        for (const dependencyTaskId of task.dependsOn) {
            const dependentTaskIds = dependentsByTaskId.get(dependencyTaskId);
            if (dependentTaskIds) {
                dependentTaskIds.push(task.taskId);
            } else {
                dependentsByTaskId.set(dependencyTaskId, [task.taskId]);
            }
        }
    }

    const dependentTaskIds = new Set<string>();
    const pendingTaskIds = [...(dependentsByTaskId.get(taskId) ?? [])];

    while (pendingTaskIds.length > 0) {
        const candidateTaskId = pendingTaskIds.shift();
        if (!candidateTaskId || dependentTaskIds.has(candidateTaskId)) {
            continue;
        }

        dependentTaskIds.add(candidateTaskId);
        pendingTaskIds.push(...(dependentsByTaskId.get(candidateTaskId) ?? []));
    }

    return dependentTaskIds;
}

export function hasActiveDependentActivity(
    runtime: WorkflowRuntimeState,
    taskId: string
): boolean {
    const dependentTaskIds = resolveDependentTaskIds(runtime.tasks, taskId);
    if (dependentTaskIds.size === 0) {
        return false;
    }

    const hasActiveDependentTask = runtime.tasks.some((task) =>
        dependentTaskIds.has(task.taskId) && (task.lifecycle === 'queued' || task.lifecycle === 'running')
    );
    if (hasActiveDependentTask) {
        return true;
    }

    return runtime.agentExecutions.some((execution) =>
        dependentTaskIds.has(execution.taskId) && isActiveAgentExecutionLifecycle(execution.lifecycle)
    );
}

export function isMissionCompleted(
    runtime: WorkflowRuntimeState,
    configuration: WorkflowConfigurationSnapshot
): boolean {
    return configuration.workflow.stageOrder.every((stageId) => isStageCompletedFromTasks(runtime.tasks, stageId, configuration)) &&
        !runtime.tasks.some((task) => task.lifecycle === 'queued' || task.lifecycle === 'running') &&
        !runtime.agentExecutions.some((execution) => isActiveAgentExecutionLifecycle(execution.lifecycle));
}