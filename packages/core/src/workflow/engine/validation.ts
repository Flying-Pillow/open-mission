import type {
    AgentExecutionRuntimeState,
    MissionTaskRuntimeState,
    MissionWorkflowConfigurationSnapshot,
    MissionWorkflowEvent,
    MissionStateData,
    MissionWorkflowRuntimeState
} from './types.js';
import {
    countOccupiedTaskExecutionSlots,
    hasActiveDependentActivity,
    isActiveSessionLifecycle,
    isReopenableTaskLifecycle,
    isTerminalTaskLifecycle,
    resolveTaskMaxReworkIterations,
    resolveEligibleStageId
} from './policy.js';

export class MissionWorkflowValidationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'MissionWorkflowValidationError';
    }
}

export function validateMissionWorkflowEvent(
    runtime: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): void {
    const errors = getMissionWorkflowEventValidationErrors(runtime, event, configuration);
    if (errors.length === 0) {
        return;
    }
    throw new MissionWorkflowValidationError(errors.join(' | '));
}

export function ensureMissionWorkflowEventAccepted(
    document: MissionStateData,
    event: MissionWorkflowEvent
): void {
    validateMissionWorkflowEvent(document.runtime, event, document.configuration);
}

export function getMissionWorkflowEventValidationErrors(
    runtime: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): string[] {
    const errors: string[] = [];
    const findTask = (taskId: string): MissionTaskRuntimeState | undefined =>
        runtime.tasks.find((task) => task.taskId === taskId);
    const findSession = (sessionId: string): AgentExecutionRuntimeState | undefined =>
        runtime.sessions.find((execution) => execution.sessionId === sessionId);
    const eligibleStageId = resolveEligibleStageId(runtime, configuration);

    switch (event.type) {
        case 'mission.created':
            break;
        case 'mission.started':
            if (runtime.lifecycle !== 'draft' && runtime.lifecycle !== 'ready') {
                errors.push(`mission.started requires lifecycle draft or ready, received '${runtime.lifecycle}'.`);
            }
            break;
        case 'mission.resumed':
            if (runtime.lifecycle !== 'paused') {
                errors.push(`mission.resumed requires lifecycle paused, received '${runtime.lifecycle}'.`);
            }
            break;
        case 'mission.paused':
            if (runtime.lifecycle === 'delivered') {
                errors.push('mission.paused is not allowed after delivery.');
            }
            break;
        case 'mission.launch-queue.restarted':
            if (runtime.lifecycle !== 'running') {
                errors.push(`mission.launch-queue.restarted requires lifecycle running, received '${runtime.lifecycle}'.`);
            }
            if (runtime.pause.paused) {
                errors.push('mission.launch-queue.restarted is not allowed while the mission is paused.');
            }
            if (runtime.launchQueue.length === 0 && !runtime.tasks.some((task) => task.lifecycle === 'queued')) {
                errors.push('mission.launch-queue.restarted requires at least one queued task or launch request.');
            }
            break;
        case 'mission.delivered':
            if (runtime.lifecycle !== 'completed') {
                errors.push(`mission.delivered requires lifecycle completed, received '${runtime.lifecycle}'.`);
            }
            break;
        case 'tasks.generated':
            if (!configuration.workflow.stages[event.stageId]) {
                errors.push(`tasks.generated references unknown stage '${event.stageId}'.`);
            }
            if (eligibleStageId !== event.stageId) {
                errors.push(`tasks.generated requires eligible stage '${eligibleStageId ?? 'none'}', received '${event.stageId}'.`);
            }
            for (const task of event.tasks) {
                const existing = findTask(task.taskId);
                if (existing && !generatedTaskPayloadMatches(existing, task)) {
                    errors.push(`tasks.generated payload for task '${task.taskId}' does not match existing runtime task.`);
                }
            }
            break;
        case 'task.launch-policy.changed': {
            const task = findTask(event.taskId);
            if (!task) {
                errors.push(`task.launch-policy.changed references unknown task '${event.taskId}'.`);
            } else if (isTerminalTaskLifecycle(task.lifecycle)) {
                errors.push(`task.launch-policy.changed is not allowed for terminal task '${event.taskId}'.`);
            }
            break;
        }
        case 'task.queued': {
            if (runtime.lifecycle === 'paused' || runtime.pause.paused) {
                errors.push('task.queued is not allowed while the mission is paused.');
            }
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task) {
                if (task.lifecycle !== 'ready') {
                    errors.push(`task.queued requires task '${event.taskId}' to be ready, received '${task.lifecycle}'.`);
                }
                if (task.stageId !== eligibleStageId) {
                    errors.push(`task.queued requires task '${event.taskId}' to be in eligible stage '${eligibleStageId ?? 'none'}'.`);
                }
                if (countOccupiedTaskExecutionSlots(runtime) >= configuration.workflow.execution.maxParallelTasks) {
                    errors.push(`task.queued exceeds execution.maxParallelTasks '${String(configuration.workflow.execution.maxParallelTasks)}'.`);
                }
            }
            break;
        }
        case 'task.started': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'queued') {
                errors.push(`task.started requires task '${event.taskId}' to be queued, received '${task.lifecycle}'.`);
            }
            break;
        }
        case 'task.configured': {
            requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            break;
        }
        case 'task.completed': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'ready' && task.lifecycle !== 'running') {
                errors.push(`task.completed requires task '${event.taskId}' to be ready or running, received '${task.lifecycle}'.`);
            }
            break;
        }
        case 'task.reopened': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task) {
                if (!isReopenableTaskLifecycle(task.lifecycle)) {
                    errors.push(`task.reopened requires task '${event.taskId}' to be completed, failed, or cancelled, received '${task.lifecycle}'.`);
                }
                if (hasActiveDependentActivity(runtime, task.taskId)) {
                    errors.push(`task.reopened for '${event.taskId}' is not allowed while downstream work is active.`);
                }
            }
            break;
        }
        case 'task.reworked': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task) {
                if (!isReopenableTaskLifecycle(task.lifecycle)) {
                    errors.push(`task.reworked requires task '${event.taskId}' to be completed, failed, or cancelled, received '${task.lifecycle}'.`);
                }
                if (hasActiveDependentActivity(runtime, task.taskId)) {
                    errors.push(`task.reworked for '${event.taskId}' is not allowed while downstream work is active.`);
                }
                if (event.summary.trim().length === 0) {
                    errors.push(`task.reworked requires a non-empty summary for task '${event.taskId}'.`);
                }
                if (event.reasonCode.trim().length === 0) {
                    errors.push(`task.reworked requires a non-empty reasonCode for task '${event.taskId}'.`);
                }
                if ((task.reworkIterationCount ?? 0) >= resolveTaskMaxReworkIterations(task)) {
                    errors.push(`task.reworked for '${event.taskId}' exceeded max rework iterations.`);
                }
            }
            break;
        }
        case 'execution.started': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'ready' && task.lifecycle !== 'queued' && task.lifecycle !== 'running') {
                errors.push(`execution.started requires task '${event.taskId}' to be ready, queued or running, received '${task.lifecycle}'.`);
            }
            if (runtime.sessions.some((execution) => execution.taskId === event.taskId && isActiveSessionLifecycle(execution.lifecycle))) {
                errors.push(`execution.started is not allowed while task '${event.taskId}' already has an active execution.`);
            }
            break;
        }
        case 'execution.launch-failed': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'ready' && task.lifecycle !== 'queued' && task.lifecycle !== 'running') {
                errors.push(`execution.launch-failed requires task '${event.taskId}' to be ready, queued or running, received '${task.lifecycle}'.`);
            }
            if (runtime.sessions.some((execution) => execution.taskId === event.taskId && isActiveSessionLifecycle(execution.lifecycle))) {
                errors.push(`execution.launch-failed is not allowed while task '${event.taskId}' already has an active execution.`);
            }
            break;
        }
        case 'execution.completed':
        case 'execution.failed':
        case 'execution.cancelled':
        case 'execution.terminated': {
            const execution = requireExecution(findSession(event.sessionId), event.sessionId, errors, event.type);
            requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (execution && !isActiveSessionLifecycle(execution.lifecycle) && execution.lifecycle !== lifecycleForSessionEvent(event.type)) {
                errors.push(`${event.type} requires session '${event.sessionId}' to be starting or running, received '${execution.lifecycle}'.`);
            }
            break;
        }
    }

    return errors;
}

function lifecycleForSessionEvent(
    eventType: 'execution.completed' | 'execution.failed' | 'execution.cancelled' | 'execution.terminated'
): AgentExecutionRuntimeState['lifecycle'] {
    switch (eventType) {
        case 'execution.completed':
            return 'completed';
        case 'execution.failed':
            return 'failed';
        case 'execution.cancelled':
            return 'cancelled';
        case 'execution.terminated':
            return 'terminated';
    }
}

function generatedTaskPayloadMatches(task: MissionTaskRuntimeState, payload: { taskId: string; title: string; instruction: string; model?: string; reasoningEffort?: string; dependsOn: string[]; context?: MissionTaskRuntimeState['context']; agentAdapter?: string }): boolean {
    return task.taskId === payload.taskId &&
        task.title === payload.title &&
        task.instruction === payload.instruction &&
        task.model === payload.model &&
        task.reasoningEffort === payload.reasoningEffort &&
        JSON.stringify(task.dependsOn) === JSON.stringify(payload.dependsOn) &&
        JSON.stringify(task.context ?? []) === JSON.stringify(payload.context ?? []) &&
        task.agentAdapter === payload.agentAdapter;
}

function requireTask(
    task: MissionTaskRuntimeState | undefined,
    taskId: string,
    errors: string[],
    eventType: string
): MissionTaskRuntimeState | undefined {
    if (!task) {
        errors.push(`${eventType} references unknown task '${taskId}'.`);
    }
    return task;
}

function requireExecution(
    session: AgentExecutionRuntimeState | undefined,
    sessionId: string,
    errors: string[],
    eventType: string
): AgentExecutionRuntimeState | undefined {
    if (!session) {
        errors.push(`${eventType} references unknown session '${sessionId}'.`);
    }
    return session;
}
