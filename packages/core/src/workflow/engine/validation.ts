import type {
    MissionAgentSessionRuntimeState,
    MissionStageId,
    MissionTaskRuntimeState,
    MissionWorkflowConfigurationSnapshot,
    MissionWorkflowEvent,
    MissionRuntimeRecord,
    MissionWorkflowRuntimeState
} from './types.js';

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
    document: MissionRuntimeRecord,
    event: MissionWorkflowEvent
): void {
    if (document.eventLog.some((record) => record.eventId === event.eventId)) {
        throw new MissionWorkflowValidationError(`Workflow event '${event.eventId}' has already been processed.`);
    }
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
    const findSession = (sessionId: string): MissionAgentSessionRuntimeState | undefined =>
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
            if (runtime.lifecycle === 'delivered') {
                errors.push('mission.panic.requested is not allowed after delivery.');
            }
            break;
        case 'mission.panic.cleared':
            if (runtime.lifecycle !== 'panicked') {
                errors.push(`mission.panic.cleared requires lifecycle panicked, received '${runtime.lifecycle}'.`);
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
            } else if (isTerminalTask(task.lifecycle)) {
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
                if (task.lifecycle !== 'ready' && task.lifecycle !== 'blocked') {
                    errors.push(`task.queued requires task '${event.taskId}' to be ready or blocked, received '${task.lifecycle}'.`);
                }
                if (task.stageId !== eligibleStageId) {
                    errors.push(`task.queued requires task '${event.taskId}' to be in eligible stage '${eligibleStageId ?? 'none'}'.`);
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
        case 'task.blocked': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (
                task &&
                task.lifecycle !== 'pending' &&
                task.lifecycle !== 'ready' &&
                task.lifecycle !== 'queued' &&
                task.lifecycle !== 'running'
            ) {
                errors.push(`task.blocked requires task '${event.taskId}' to be pending, ready, queued, or running, received '${task.lifecycle}'.`);
            }
            break;
        }
        case 'task.reopened': {
            const task = requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (task) {
                if (task.lifecycle !== 'completed' && task.lifecycle !== 'failed' && task.lifecycle !== 'cancelled' && task.lifecycle !== 'blocked') {
                    errors.push(`task.reopened requires task '${event.taskId}' to be completed, failed, cancelled, or blocked, received '${task.lifecycle}'.`);
                }
                const stageOrder = configuration.workflow.stageOrder;
                const reopenedStageIndex = stageOrder.indexOf(task.stageId);
                const hasActiveDownstreamWork = runtime.tasks.some((candidate) => {
                    const candidateStageIndex = stageOrder.indexOf(candidate.stageId);
                    return candidateStageIndex > reopenedStageIndex && (candidate.lifecycle === 'queued' || candidate.lifecycle === 'running');
                });
                const hasActiveDownstreamSessions = runtime.sessions.some((session) => {
                    const sessionTask = findTask(session.taskId);
                    if (!sessionTask) {
                        return false;
                    }
                    const candidateStageIndex = stageOrder.indexOf(sessionTask.stageId);
                    return candidateStageIndex > reopenedStageIndex && isActiveSessionLifecycle(session.lifecycle);
                });
                if (hasActiveDownstreamWork || hasActiveDownstreamSessions) {
                    errors.push(`task.reopened for '${event.taskId}' is not allowed while downstream work is active.`);
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
            if (runtime.sessions.some((session) => session.taskId === event.taskId)) {
                errors.push(`session.launch-failed is not allowed after a session record already exists for task '${event.taskId}'.`);
            }
            break;
        }
        case 'session.completed':
        case 'session.failed':
        case 'session.cancelled':
        case 'session.terminated': {
            const session = requireSession(findSession(event.sessionId), event.sessionId, errors, event.type);
            requireTask(findTask(event.taskId), event.taskId, errors, event.type);
            if (session && !isActiveSessionLifecycle(session.lifecycle)) {
                errors.push(`${event.type} requires session '${event.sessionId}' to be starting or running, received '${session.lifecycle}'.`);
            }
            break;
        }
    }

    return errors;
}

function isActiveSessionLifecycle(lifecycle: MissionAgentSessionRuntimeState['lifecycle']): boolean {
    return lifecycle === 'starting' || lifecycle === 'running';
}

function resolveEligibleStageId(
    runtime: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): MissionStageId | undefined {
    for (const stageId of configuration.workflow.stageOrder) {
        const stageTasks = runtime.tasks.filter((task) => task.stageId === stageId);
        const complete =
            (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
            isImplicitlyCompletedEmptyFinalStage(stageId, stageTasks, configuration);
        if (!complete) {
            return stageId;
        }
    }
    return undefined;
}

function isImplicitlyCompletedEmptyFinalStage(
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

    const generationRule = configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === stageId);
    if (!generationRule) {
        return true;
    }

    return generationRule.templateSources.length === 0 && generationRule.tasks.length === 0;
}

function generatedTaskPayloadMatches(task: MissionTaskRuntimeState, payload: { taskId: string; title: string; instruction: string; dependsOn: string[]; agentRunner?: string }): boolean {
    return task.taskId === payload.taskId &&
        task.title === payload.title &&
        task.instruction === payload.instruction &&
        JSON.stringify(task.dependsOn) === JSON.stringify(payload.dependsOn) &&
        task.agentRunner === payload.agentRunner;
}

function isTerminalTask(lifecycle: MissionTaskRuntimeState['lifecycle']): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
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
    session: MissionAgentSessionRuntimeState | undefined,
    sessionId: string,
    errors: string[],
    eventType: string
): MissionAgentSessionRuntimeState | undefined {
    if (!session) {
        errors.push(`${eventType} references unknown session '${sessionId}'.`);
    }
    return session;
}
