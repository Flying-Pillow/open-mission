import type {
    MissionAgentSessionLifecycleState,
    MissionStageId,
    MissionTaskLifecycleState,
    MissionTaskRuntimeState,
    MissionWorkflowConfigurationSnapshot,
    MissionWorkflowRequest,
    MissionWorkflowRuntimeState
} from './types.js';

export function isActiveSessionLifecycle(lifecycle: MissionAgentSessionLifecycleState): boolean {
    return lifecycle === 'starting' || lifecycle === 'running';
}

export function isTerminalTaskLifecycle(lifecycle: MissionTaskLifecycleState): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

export function isReopenableTaskLifecycle(lifecycle: MissionTaskLifecycleState): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

export function resolveEligibleStageId(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): MissionStageId | undefined {
    for (const stageId of configuration.workflow.stageOrder) {
        if (!isStageCompletedFromTasks(runtime.tasks, stageId, configuration)) {
            return stageId;
        }
    }
    return undefined;
}

export function isStageCompletedFromTasks(
    tasks: MissionTaskRuntimeState[],
    stageId: MissionStageId,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    const stageTasks = tasks.filter((task) => task.stageId === stageId);
    return (
        (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
        isImplicitlyCompletedEmptyFinalStageFromTasks(tasks, stageId, stageTasks, configuration)
    );
}

export function isStageCompleted(
    runtime: MissionWorkflowRuntimeState,
    stageId: MissionStageId,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return isStageCompletedFromTasks(runtime.tasks, stageId, configuration);
}

export function isImplicitlyCompletedEmptyFinalStageFromTasks(
    tasks: MissionTaskRuntimeState[],
    stageId: MissionStageId,
    stageTasks: MissionTaskRuntimeState[],
    configuration: MissionWorkflowConfigurationSnapshot
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
    runtime: MissionWorkflowRuntimeState,
    stageId: MissionStageId,
    stageTasks: MissionTaskRuntimeState[],
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return isImplicitlyCompletedEmptyFinalStageFromTasks(runtime.tasks, stageId, stageTasks, configuration);
}

export function resolvePendingTaskGenerationStageId(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
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
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot,
    issuedAt: string
): MissionWorkflowRequest[] {
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

export function countOccupiedTaskExecutionSlots(runtime: MissionWorkflowRuntimeState): number {
    return runtime.tasks.filter((task) => task.lifecycle === 'queued' || task.lifecycle === 'running').length;
}

export function countOccupiedSessionExecutionSlots(runtime: MissionWorkflowRuntimeState): number {
    const activeSessions = runtime.sessions.filter((session) => isActiveSessionLifecycle(session.lifecycle)).length;
    const dispatchedLaunches = runtime.launchQueue.filter((request) =>
        Boolean(request.dispatchedAt) &&
        !runtime.sessions.some((session) =>
            session.taskId === request.taskId && isActiveSessionLifecycle(session.lifecycle)
        )
    ).length;
    return activeSessions + dispatchedLaunches;
}

export function hasAvailableTaskExecutionSlot(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return countOccupiedTaskExecutionSlots(runtime) < configuration.workflow.execution.maxParallelTasks;
}

export function hasAvailableSessionExecutionSlot(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return countOccupiedSessionExecutionSlots(runtime) < configuration.workflow.execution.maxParallelSessions;
}

export function resolveDependentTaskIds(
    tasks: MissionTaskRuntimeState[],
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
    runtime: MissionWorkflowRuntimeState,
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

    return runtime.sessions.some((session) =>
        dependentTaskIds.has(session.taskId) && isActiveSessionLifecycle(session.lifecycle)
    );
}

export function isMissionCompleted(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return configuration.workflow.stageOrder.every((stageId) => isStageCompletedFromTasks(runtime.tasks, stageId, configuration)) &&
        !runtime.tasks.some((task) => task.lifecycle === 'queued' || task.lifecycle === 'running') &&
        !runtime.sessions.some((session) => isActiveSessionLifecycle(session.lifecycle));
}