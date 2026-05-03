import type {
    AgentSessionRuntimeState,
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
    const findSession = (sessionId: string): AgentSessionRuntimeState | undefined =>
        runtime.sessions.find((session) => session.sessionId === sessionId);
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
            if (runtime.panic.active) {
                errors.push('mission.resumed is not allowed while panic is active.');
            }
            break;
        case 'mission.paused':
            if (runtime.lifecycle === 'delivered') {
                errors.push('mission.paused is not allowed after delivery.');
            }
            break;
        case 'mission.panic.requested':
            if (runtime.lifecycle === 'completed' || runtime.lifecycle === 'delivered') {
                errors.push('mission.panic.requested is not allowed after mission completion.');
            }
            break;
        case 'mission.panic.cleared':
            if (runtime.lifecycle !== 'panicked' && !(runtime.lifecycle === 'paused' && runtime.pause.reason === 'panic' && !runtime.panic.active)) {
                errors.push(`mission.panic.cleared requires lifecycle panicked or paused after panic clear, received '${runtime.lifecycle}'.`);
            }
            break;
        case 'mission.launch-queue.restarted':
            if (runtime.lifecycle !== 'running') {
                errors.push(`mission.launch-queue.restarted requires lifecycle running, received '${runtime.lifecycle}'.`);
            }
            if (runtime.pause.paused) {
                errors.push('mission.launch-queue.restarted is not allowed while the mission is paused.');
            }
            if (runtime.panic.active) {
                errors.push('mission.launch-queue.restarted is not allowed while panic is active.');
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
            if (runtime.lifecycle === 'panicked' || runtime.panic.active) {
                errors.push('task.queued is not allowed while the mission is panicked.');
            }
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
        case 'session.started': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'ready' && task.lifecycle !== 'queued' && task.lifecycle !== 'running') {
                errors.push(`session.started requires task '${event.taskId}' to be ready, queued or running, received '${task.lifecycle}'.`);
            }
            if (runtime.sessions.some((session) => session.taskId === event.taskId && isActiveSessionLifecycle(session.lifecycle))) {
                errors.push(`session.started is not allowed while task '${event.taskId}' already has an active session.`);
            }
            break;
        }
        case 'session.launch-failed': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task && task.lifecycle !== 'ready' && task.lifecycle !== 'queued' && task.lifecycle !== 'running') {
                errors.push(`session.launch-failed requires task '${event.taskId}' to be ready, queued or running, received '${task.lifecycle}'.`);
            }
            if (runtime.sessions.some((session) => session.taskId === event.taskId && isActiveSessionLifecycle(session.lifecycle))) {
                errors.push(`session.launch-failed is not allowed while task '${event.taskId}' already has an active session.`);
            }
            break;
        }
        case 'session.completed':
        case 'session.failed':
        case 'session.cancelled':
        case 'session.terminated': {
            const session = requireSession(findSession(event.sessionId), event.sessionId, errors, event.type);
            requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (session && !isActiveSessionLifecycle(session.lifecycle) && session.lifecycle !== lifecycleForSessionEvent(event.type)) {
                errors.push(`${event.type} requires session '${event.sessionId}' to be starting or running, received '${session.lifecycle}'.`);
            }
            break;
        }
    }

    return errors;
}

function lifecycleForSessionEvent(
    eventType: 'session.completed' | 'session.failed' | 'session.cancelled' | 'session.terminated'
): AgentSessionRuntimeState['lifecycle'] {
    switch (eventType) {
        case 'session.completed':
            return 'completed';
        case 'session.failed':
            return 'failed';
        case 'session.cancelled':
            return 'cancelled';
        case 'session.terminated':
            return 'terminated';
    }
}

function generatedTaskPayloadMatches(task: MissionTaskRuntimeState, payload: { taskId: string; title: string; instruction: string; dependsOn: string[]; agentRunner?: string }): boolean {
    return task.taskId === payload.taskId &&
        task.title === payload.title &&
        task.instruction === payload.instruction &&
        JSON.stringify(task.dependsOn) === JSON.stringify(payload.dependsOn) &&
        task.agentRunner === payload.agentRunner;
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

function requireSession(
    session: AgentSessionRuntimeState | undefined,
    sessionId: string,
    errors: string[],
    eventType: string
): AgentSessionRuntimeState | undefined {
    if (!session) {
        errors.push(`${eventType} references unknown session '${sessionId}'.`);
    }
    return session;
}
