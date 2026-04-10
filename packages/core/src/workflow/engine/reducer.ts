import {
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionWorkflowReducer,
    type MissionWorkflowReducerResult,
    type MissionWorkflowRuntimeState,
    type MissionWorkflowSignal,
    type MissionTaskRuntimeState,
    type MissionTaskLifecycleState,
    type MissionStageRuntimeProjection,
    type MissionGateProjection,
    type MissionAgentSessionRuntimeState
} from './types.js';
import { createInitialMissionWorkflowRuntimeState } from './document.js';

type NormalizationResult = {
    state: MissionWorkflowRuntimeState;
    signals: MissionWorkflowSignal[];
    requests: MissionWorkflowRequest[];
};

export class DefaultMissionWorkflowReducer implements MissionWorkflowReducer {
    public reduce(
        current: MissionWorkflowRuntimeState,
        event: MissionWorkflowEvent,
        configuration: MissionWorkflowConfigurationSnapshot
    ): MissionWorkflowReducerResult {
        const working = cloneRuntimeState(current);
        applyEventMutation(working, event, configuration);
        const normalized = normalizeState(working, event, configuration);
        return {
            nextState: normalized.state,
            signals: normalized.signals,
            requests: normalized.requests
        };
    }
}

export function createMissionWorkflowReducer(): MissionWorkflowReducer {
    return new DefaultMissionWorkflowReducer();
}

export function reduceMissionWorkflowEvent(
    current: MissionWorkflowRuntimeState | undefined,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): MissionWorkflowReducerResult {
    const reducer = createMissionWorkflowReducer();
    return reducer.reduce(current ?? createInitialMissionWorkflowRuntimeState(configuration), event, configuration);
}

function applyEventMutation(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): void {
    state.updatedAt = event.occurredAt;

    switch (event.type) {
        case 'mission.created':
            state.lifecycle = 'ready';
            assignActiveStageId(state, configuration.workflow.stageOrder[0]);
            state.pause = { paused: false };
            state.panic = {
                active: false,
                terminateSessions: configuration.workflow.panic.terminateSessions,
                clearLaunchQueue: configuration.workflow.panic.clearLaunchQueue,
                haltMission: configuration.workflow.panic.haltMission
            };
            return;
        case 'mission.started':
            if (configuration.workflow.humanInLoop.enabled && configuration.workflow.humanInLoop.pauseOnMissionStart) {
                state.lifecycle = 'paused';
                state.pause = {
                    paused: true,
                    reason: 'checkpoint',
                    targetType: 'mission',
                    requestedAt: event.occurredAt
                };
            } else {
                state.lifecycle = 'running';
                state.pause = { paused: false };
            }
            return;
        case 'mission.resumed':
            state.lifecycle = 'running';
            state.pause = { paused: false };
            return;
        case 'mission.paused':
            state.lifecycle = 'paused';
            state.pause = {
                paused: true,
                reason: event.reason,
                ...(event.targetType ? { targetType: event.targetType } : {}),
                ...(event.targetId ? { targetId: event.targetId } : {}),
                requestedAt: event.occurredAt
            };
            return;
        case 'mission.panic.requested':
            state.lifecycle = 'panicked';
            state.pause = {
                paused: true,
                reason: 'panic',
                targetType: 'mission',
                requestedAt: event.occurredAt
            };
            state.panic = {
                active: true,
                requestedAt: event.occurredAt,
                requestedBy: event.source === 'human' ? 'human' : 'system',
                terminateSessions: configuration.workflow.panic.terminateSessions,
                clearLaunchQueue: configuration.workflow.panic.clearLaunchQueue,
                haltMission: configuration.workflow.panic.haltMission
            };
            if (state.panic.clearLaunchQueue) {
                const queuedTaskIds = new Set(state.launchQueue.map((request) => request.taskId));
                state.launchQueue = [];
                state.tasks = state.tasks.map((task) =>
                    queuedTaskIds.has(task.taskId) && task.lifecycle === 'queued'
                        ? {
                            ...task,
                            lifecycle: 'ready',
                            updatedAt: event.occurredAt
                        }
                        : task
                );
            }
            return;
        case 'mission.panic.cleared':
            state.lifecycle = 'paused';
            state.pause = {
                paused: true,
                reason: 'panic',
                requestedAt: event.occurredAt
            };
            state.panic = {
                ...state.panic,
                active: false
            };
            return;
        case 'mission.delivered':
            state.lifecycle = 'delivered';
            return;
        case 'tasks.generated': {
            const stageDefinition = configuration.workflow.stages[event.stageId];
            if (!stageDefinition) {
                return;
            }
            const existingTaskIds = new Set(state.tasks.map((task) => task.taskId));
            const createdTasks = event.tasks
                .filter((task) => !existingTaskIds.has(task.taskId))
                .map<MissionTaskRuntimeState>((task) => ({
                    taskId: task.taskId,
                    stageId: event.stageId,
                    title: task.title,
                    instruction: task.instruction,
                    dependsOn: [...task.dependsOn],
                    lifecycle: 'pending',
                    blockedByTaskIds: [],
                    runtime: {
                        autostart: stageDefinition.taskLaunchPolicy.defaultAutostart,
                        launchMode: stageDefinition.taskLaunchPolicy.launchMode
                    },
                    ...(task.agentRunner ? { agentRunner: task.agentRunner } : {}),
                    retries: 0,
                    createdAt: event.occurredAt,
                    updatedAt: event.occurredAt
                }));
            state.tasks = [...state.tasks, ...createdTasks];
            return;
        }
        case 'task.launch-policy.changed':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        runtime: {
                            autostart: event.autostart,
                            launchMode: event.launchMode
                        },
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'task.queued':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'queued',
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'task.started':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'running',
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'task.completed':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'completed',
                        completedAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'task.blocked':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'blocked',
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'task.reopened':
            state.tasks = state.tasks.map((task) => {
                if (task.taskId !== event.taskId) {
                    return task;
                }
                const { completedAt, failedAt, cancelledAt, ...rest } = task;
                void completedAt;
                void failedAt;
                void cancelledAt;
                return {
                    ...rest,
                    lifecycle: 'pending',
                    updatedAt: event.occurredAt
                };
            });
            return;
        case 'session.started': {
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'running',
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            state.sessions = upsertSession(state.sessions, {
                sessionId: event.sessionId,
                taskId: event.taskId,
                runnerId: event.runnerId,
                ...(event.transportId ? { transportId: event.transportId } : {}),
                lifecycle: 'running',
                launchedAt: event.occurredAt,
                updatedAt: event.occurredAt
            });
            state.launchQueue = state.launchQueue.filter((request) => request.taskId !== event.taskId);
            return;
        }
        case 'session.launch-failed':
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'failed',
                        failedAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            state.launchQueue = state.launchQueue.filter((request) => request.taskId !== event.taskId);
            return;
        case 'session.completed':
            state.sessions = updateSessionLifecycle(state.sessions, event.sessionId, 'completed', event.occurredAt);
            return;
        case 'session.failed':
            state.sessions = updateSessionLifecycle(state.sessions, event.sessionId, 'failed', event.occurredAt);
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'failed',
                        failedAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'session.cancelled':
            state.sessions = updateSessionLifecycle(state.sessions, event.sessionId, 'cancelled', event.occurredAt);
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'cancelled',
                        cancelledAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
        case 'session.terminated':
            state.sessions = updateSessionLifecycle(state.sessions, event.sessionId, 'terminated', event.occurredAt);
            state.tasks = state.tasks.map((task) =>
                task.taskId === event.taskId
                    ? {
                        ...task,
                        lifecycle: 'cancelled',
                        cancelledAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                    : task
            );
            return;
    }
}

function normalizeState(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): NormalizationResult {
    const nextState = cloneRuntimeState(state);
    const signals: MissionWorkflowSignal[] = [];
    const requests: MissionWorkflowRequest[] = [];
    const tasksById = new Map(nextState.tasks.map((task) => [task.taskId, task]));
    const eligibleStageId = resolveEligibleStageId(nextState, configuration);
    assignActiveStageId(nextState, eligibleStageId);

    nextState.tasks = nextState.tasks.map((task) => {
        const blockedByTaskIds = task.dependsOn.filter((dependencyTaskId) => tasksById.get(dependencyTaskId)?.lifecycle !== 'completed');
        const stageEligible = task.stageId === eligibleStageId;
        let lifecycle: MissionTaskLifecycleState = task.lifecycle;

        if (isTerminalTaskLifecycle(lifecycle) || lifecycle === 'queued' || lifecycle === 'running') {
            return {
                ...task,
                blockedByTaskIds,
                updatedAt: task.updatedAt
            };
        }

        if (!stageEligible) {
            lifecycle = 'pending';
        } else if (lifecycle === 'blocked') {
            lifecycle = 'blocked';
        } else if (blockedByTaskIds.length > 0) {
            lifecycle = 'pending';
        } else {
            lifecycle = 'ready';
        }

        return {
            ...task,
            lifecycle,
            blockedByTaskIds,
            updatedAt: task.updatedAt
        };
    });

    enforceLifecycleInvariants(nextState, configuration, event.occurredAt);
    queueAutostartTasks(nextState, event, configuration, requests);
    nextState.stages = buildStageProjections(nextState, configuration);
    nextState.gates = buildGateProjections(nextState, configuration, event.occurredAt);

    if (nextState.lifecycle !== 'delivered' && isMissionCompleted(nextState, configuration)) {
        if (nextState.lifecycle !== 'completed') {
            nextState.lifecycle = 'completed';
            signals.push(createSignal('mission.completed', event.occurredAt, {}));
            signals.push(createSignal('mission.delivered-ready', event.occurredAt, {}));
            requests.push(createRequest('mission.mark-completed', event.occurredAt, {}));
        }
    }

    for (const stage of nextState.stages) {
        if (stage.lifecycle === 'ready') {
            signals.push(createSignal('stage.ready', event.occurredAt, { stageId: stage.stageId }));
        }
        if (stage.lifecycle === 'completed') {
            signals.push(createSignal('stage.completed', event.occurredAt, { stageId: stage.stageId }));
        }
    }

    for (const task of nextState.tasks) {
        if (task.lifecycle === 'ready') {
            signals.push(createSignal('task.ready', event.occurredAt, { taskId: task.taskId, stageId: task.stageId }));
        }
    }

    for (const gate of nextState.gates) {
        signals.push(createSignal(gate.state === 'passed' ? 'gate.passed' : 'gate.blocked', event.occurredAt, {
            gateId: gate.gateId,
            state: gate.state,
            ...(gate.stageId ? { stageId: gate.stageId } : {})
        }));
    }

    const generationRequests = buildGenerationRequests(nextState, event, configuration);
    requests.push(...generationRequests);

    if (nextState.panic.active && nextState.panic.terminateSessions) {
        for (const session of nextState.sessions) {
            if (session.lifecycle === 'starting' || session.lifecycle === 'running') {
                requests.push(createRequest('session.terminate', event.occurredAt, {
                    sessionId: session.sessionId,
                    taskId: session.taskId,
                    runnerId: session.runnerId
                }));
            }
        }
    }

    nextState.updatedAt = event.occurredAt;
    return { state: nextState, signals, requests };
}

function buildGenerationRequests(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot
): MissionWorkflowRequest[] {
    const eligibleStageId = resolveEligibleStageId(state, configuration);
    if (!eligibleStageId) {
        return [];
    }
    const hasTasks = state.tasks.some((task) => task.stageId === eligibleStageId);
    if (hasTasks) {
        return [];
    }
    return [
        createRequest('tasks.request-generation', event.occurredAt, {
            stageId: eligibleStageId
        })
    ];
}

function enforceLifecycleInvariants(
    state: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot,
    occurredAt: string
): void {
    const defaultPanicState = {
        terminateSessions: configuration.workflow.panic.terminateSessions,
        clearLaunchQueue: configuration.workflow.panic.clearLaunchQueue,
        haltMission: configuration.workflow.panic.haltMission
    };

    switch (state.lifecycle) {
        case 'running':
            state.pause = { paused: false };
            state.panic = {
                ...state.panic,
                ...defaultPanicState,
                active: false
            };
            return;
        case 'paused':
            state.pause = {
                paused: true,
                reason: state.pause.reason ?? 'human-requested',
                ...(state.pause.targetType ? { targetType: state.pause.targetType } : {}),
                ...(state.pause.targetId ? { targetId: state.pause.targetId } : {}),
                requestedAt: state.pause.requestedAt ?? occurredAt
            };
            state.panic = {
                ...state.panic,
                ...defaultPanicState,
                active: false
            };
            return;
        case 'panicked':
            state.pause = {
                paused: true,
                reason: 'panic',
                targetType: state.pause.targetType ?? 'mission',
                ...(state.pause.targetId ? { targetId: state.pause.targetId } : {}),
                requestedAt: state.pause.requestedAt ?? state.panic.requestedAt ?? occurredAt
            };
            state.panic = {
                ...state.panic,
                ...defaultPanicState,
                active: true,
                requestedAt: state.panic.requestedAt ?? occurredAt,
                requestedBy: state.panic.requestedBy ?? 'system'
            };
            return;
        default:
            state.pause = { paused: false };
            state.panic = {
                ...state.panic,
                ...defaultPanicState,
                active: false
            };
    }
}

function queueAutostartTasks(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    configuration: MissionWorkflowConfigurationSnapshot,
    requests: MissionWorkflowRequest[]
): void {
    void state;
    void event;
    void configuration;
    void requests;
}

function buildStageProjections(
    state: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): MissionStageRuntimeProjection[] {
    const eligibleStageId = resolveEligibleStageId(state, configuration);
    return configuration.workflow.stageOrder.map((stageId) => {
        const stageTasks = state.tasks.filter((task) => task.stageId === stageId);
        const readyTaskIds = stageTasks.filter((task) => task.lifecycle === 'ready').map((task) => task.taskId);
        const queuedTaskIds = stageTasks.filter((task) => task.lifecycle === 'queued').map((task) => task.taskId);
        const runningTaskIds = stageTasks.filter((task) => task.lifecycle === 'running').map((task) => task.taskId);
        const blockedTaskIds = stageTasks.filter((task) => task.lifecycle === 'blocked').map((task) => task.taskId);
        const completedTaskIds = stageTasks.filter((task) => task.lifecycle === 'completed').map((task) => task.taskId);
        const completed =
            (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
            isImplicitlyCompletedEmptyFinalStage(state, stageId, stageTasks, configuration);
        const eligible = stageId === eligibleStageId || completed;
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
            lifecycle = 'blocked';
        }

        return {
            stageId,
            lifecycle,
            taskIds: stageTasks.map((task) => task.taskId),
            readyTaskIds,
            queuedTaskIds,
            runningTaskIds,
            blockedTaskIds,
            completedTaskIds
        };
    });
}

function buildGateProjections(
    state: MissionWorkflowRuntimeState,
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
        const stage = state.stages.find((candidate) => candidate.stageId === gate.stageId);
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

function resolveEligibleStageId(
    state: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): string | undefined {
    for (const stageId of configuration.workflow.stageOrder) {
        const stageTasks = state.tasks.filter((task) => task.stageId === stageId);
        const completed =
            (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
            isImplicitlyCompletedEmptyFinalStage(state, stageId, stageTasks, configuration);
        if (!completed) {
            return stageId;
        }
    }
    return undefined;
}

function isImplicitlyCompletedEmptyFinalStage(
    state: MissionWorkflowRuntimeState,
    stageId: string,
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
            const priorStageTasks = state.tasks.filter((task) => task.stageId === priorStageId);
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

function isMissionCompleted(
    state: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot
): boolean {
    return configuration.workflow.stageOrder.every((stageId) => {
        const stage = state.stages.find((candidate) => candidate.stageId === stageId);
        return stage?.lifecycle === 'completed';
    }) &&
        !state.tasks.some((task) => task.lifecycle === 'queued' || task.lifecycle === 'running') &&
        !state.sessions.some((session) => session.lifecycle === 'starting' || session.lifecycle === 'running');
}

function isTerminalTaskLifecycle(lifecycle: MissionTaskLifecycleState): boolean {
    return lifecycle === 'completed' || lifecycle === 'failed' || lifecycle === 'cancelled';
}

function upsertSession(
    sessions: MissionAgentSessionRuntimeState[],
    session: MissionAgentSessionRuntimeState
): MissionAgentSessionRuntimeState[] {
    const existingIndex = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
    if (existingIndex < 0) {
        return [...sessions, session];
    }
    const next = [...sessions];
    next[existingIndex] = session;
    return next;
}

function updateSessionLifecycle(
    sessions: MissionAgentSessionRuntimeState[],
    sessionId: string,
    lifecycle: MissionAgentSessionRuntimeState['lifecycle'],
    occurredAt: string
): MissionAgentSessionRuntimeState[] {
    return sessions.map((session) =>
        session.sessionId === sessionId
            ? {
                ...session,
                lifecycle,
                updatedAt: occurredAt,
                ...(lifecycle === 'completed' ? { completedAt: occurredAt } : {}),
                ...(lifecycle === 'failed' ? { failedAt: occurredAt } : {}),
                ...(lifecycle === 'cancelled' ? { cancelledAt: occurredAt } : {}),
                ...(lifecycle === 'terminated' ? { terminatedAt: occurredAt } : {})
            }
            : session
    );
}

function cloneRuntimeState(state: MissionWorkflowRuntimeState): MissionWorkflowRuntimeState {
    return {
        lifecycle: state.lifecycle,
        ...(state.activeStageId ? { activeStageId: state.activeStageId } : {}),
        pause: { ...state.pause },
        panic: { ...state.panic },
        stages: state.stages.map((stage) => ({
            ...stage,
            taskIds: [...stage.taskIds],
            readyTaskIds: [...stage.readyTaskIds],
            queuedTaskIds: [...stage.queuedTaskIds],
            runningTaskIds: [...stage.runningTaskIds],
            blockedTaskIds: [...stage.blockedTaskIds],
            completedTaskIds: [...stage.completedTaskIds]
        })),
        tasks: state.tasks.map((task) => ({
            ...task,
            dependsOn: [...task.dependsOn],
            blockedByTaskIds: [...task.blockedByTaskIds],
            runtime: { ...task.runtime }
        })),
        sessions: state.sessions.map((session) => ({ ...session })),
        gates: state.gates.map((gate) => ({ ...gate, reasons: [...gate.reasons] })),
        launchQueue: state.launchQueue.map((request) => ({ ...request })),
        updatedAt: state.updatedAt
    };
}

function assignActiveStageId(
    state: MissionWorkflowRuntimeState,
    activeStageId: string | undefined
): void {
    if (activeStageId) {
        state.activeStageId = activeStageId;
        return;
    }
    delete state.activeStageId;
}

function createSignal(
    type: MissionWorkflowSignal['type'],
    emittedAt: string,
    payload: Record<string, unknown>
): MissionWorkflowSignal {
    return {
        signalId: `${type}:${emittedAt}:${JSON.stringify(payload)}`,
        type,
        emittedAt,
        payload
    };
}

function createRequest(
    type: MissionWorkflowRequest['type'],
    occurredAt: string,
    payload: Record<string, unknown>
): MissionWorkflowRequest {
    return {
        requestId: `${type}:${occurredAt}:${JSON.stringify(payload)}`,
        type,
        payload
    };
}
