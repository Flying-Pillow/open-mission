import {
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionWorkflowReducer,
    type MissionWorkflowReducerResult,
    type MissionWorkflowRuntimeState,
    type MissionWorkflowSignal,
    type MissionTaskRuntimeState,
    type AgentSessionRuntimeState
} from './types.js';
import { createInitialMissionWorkflowRuntimeState } from './document.js';
import {
    buildReworkPendingLaunchContext,
    buildWorkflowTaskGenerationRequests,
    countOccupiedSessionExecutionSlots,
    countOccupiedTaskExecutionSlots,
    isActiveSessionLifecycle,
    isMissionCompleted,
    resolveTaskMaxReworkIterations,
    resolveDependentTaskIds
} from './policy.js';
import { deriveMissionWorkflowProjectionState } from './projection.js';

export class DefaultMissionWorkflowReducer implements MissionWorkflowReducer {
    public reduce(
        current: MissionWorkflowRuntimeState,
        event: MissionWorkflowEvent,
        configuration: MissionWorkflowConfigurationSnapshot
    ): MissionWorkflowReducerResult {
        return new MissionWorkflowReductionCycle(current, event, configuration).reduce();
    }
}

class MissionWorkflowReductionCycle {
    private readonly state: MissionWorkflowRuntimeState;
    private readonly signals: MissionWorkflowSignal[] = [];
    private readonly requests: MissionWorkflowRequest[] = [];

    public constructor(
        current: MissionWorkflowRuntimeState,
        private readonly event: MissionWorkflowEvent,
        private readonly configuration: MissionWorkflowConfigurationSnapshot
    ) {
        this.state = cloneRuntimeState(current);
    }

    public reduce(): MissionWorkflowReducerResult {
        const suppressAutostart = isInactiveSessionLifecycleEvent(this.state, this.event);
        new MissionWorkflowTransitionEngine(this.state, this.event, this.configuration).apply();
        new MissionWorkflowDerivationEngine(this.state, this.event, this.configuration, this.signals, this.requests, suppressAutostart).derive();
        return {
            nextState: this.state,
            signals: this.signals,
            requests: this.requests
        };
    }
}

class MissionWorkflowTransitionEngine {
    public constructor(
        private readonly state: MissionWorkflowRuntimeState,
        private readonly event: MissionWorkflowEvent,
        private readonly configuration: MissionWorkflowConfigurationSnapshot
    ) { }

    public apply(): void {
        const event = this.event;
        this.state.updatedAt = event.occurredAt;

        switch (event.type) {
            case 'mission.created':
                this.state.lifecycle = 'ready';
                assignActiveStageId(this.state, this.configuration.workflow.stageOrder[0]);
                this.state.pause = { paused: false };
                this.state.panic = {
                    active: false,
                    terminateSessions: this.configuration.workflow.panic.terminateSessions,
                    clearLaunchQueue: this.configuration.workflow.panic.clearLaunchQueue,
                    haltMission: this.configuration.workflow.panic.haltMission
                };
                return;
            case 'mission.started':
                if (this.configuration.workflow.humanInLoop.enabled && this.configuration.workflow.humanInLoop.pauseOnMissionStart) {
                    this.state.lifecycle = 'paused';
                    this.state.pause = {
                        paused: true,
                        reason: 'checkpoint',
                        targetType: 'mission',
                        requestedAt: event.occurredAt
                    };
                } else {
                    this.state.lifecycle = 'running';
                    this.state.pause = { paused: false };
                }
                return;
            case 'mission.resumed':
                this.state.lifecycle = 'running';
                this.state.pause = { paused: false };
                return;
            case 'mission.paused':
                this.state.lifecycle = 'paused';
                this.state.pause = {
                    paused: true,
                    reason: event.reason,
                    ...(event.targetType ? { targetType: event.targetType } : {}),
                    ...(event.targetId ? { targetId: event.targetId } : {}),
                    requestedAt: event.occurredAt
                };
                return;
            case 'mission.panic.requested':
                this.state.lifecycle = 'panicked';
                this.state.pause = {
                    paused: true,
                    reason: 'panic',
                    targetType: 'mission',
                    requestedAt: event.occurredAt
                };
                this.state.panic = {
                    active: true,
                    requestedAt: event.occurredAt,
                    requestedBy: event.source === 'human' ? 'human' : 'system',
                    terminateSessions: this.configuration.workflow.panic.terminateSessions,
                    clearLaunchQueue: this.configuration.workflow.panic.clearLaunchQueue,
                    haltMission: this.configuration.workflow.panic.haltMission
                };
                if (this.state.panic.clearLaunchQueue) {
                    const queuedTaskIds = new Set(this.state.launchQueue.map((request) => request.taskId));
                    this.state.launchQueue = [];
                    this.state.tasks = this.state.tasks.map((task) =>
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
                this.state.lifecycle = 'paused';
                this.state.pause = {
                    paused: true,
                    reason: 'panic',
                    requestedAt: event.occurredAt
                };
                this.state.panic = {
                    ...this.state.panic,
                    active: false
                };
                return;
            case 'mission.launch-queue.restarted': {
                const existingRequestsByTaskId = new Map(this.state.launchQueue.map((request) => [request.taskId, request]));
                const queuedTasks = this.state.tasks.filter((task) => task.lifecycle === 'queued');
                this.state.launchQueue = queuedTasks.map((task, index) => {
                    const existing = existingRequestsByTaskId.get(task.taskId);
                    return {
                        requestId: `task.launch:${task.taskId}:${event.occurredAt}:${index.toString(36)}`,
                        taskId: task.taskId,
                        requestedAt: event.occurredAt,
                        requestedBy: event.source === 'human' ? 'human' : event.source === 'daemon' ? 'daemon' : 'system',
                        causedByEventId: event.eventId,
                        ...(existing?.runnerId ? { runnerId: existing.runnerId } : {}),
                        ...(existing?.prompt ? { prompt: existing.prompt } : {}),
                        ...(existing?.workingDirectory ? { workingDirectory: existing.workingDirectory } : {}),
                        ...(existing?.terminalSessionName ? { terminalSessionName: existing.terminalSessionName } : {})
                    };
                });
                this.state.tasks = this.state.tasks.map((task) =>
                    task.lifecycle === 'queued'
                        ? {
                            ...task,
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                return;
            }
            case 'mission.delivered':
                this.state.lifecycle = 'delivered';
                return;
            case 'tasks.generated': {
                const stageDefinition = this.configuration.workflow.stages[event.stageId];
                if (!stageDefinition) {
                    return;
                }
                const existingTaskIds = new Set(this.state.tasks.map((task) => task.taskId));
                const createdTasks = event.tasks
                    .filter((task) => !existingTaskIds.has(task.taskId))
                    .map<MissionTaskRuntimeState>((task) => ({
                        taskId: task.taskId,
                        stageId: event.stageId,
                        title: task.title,
                        instruction: task.instruction,
                        ...(task.taskKind ? { taskKind: task.taskKind } : {}),
                        ...(task.pairedTaskId ? { pairedTaskId: task.pairedTaskId } : {}),
                        dependsOn: [...task.dependsOn],
                        lifecycle: 'pending',
                        waitingOnTaskIds: [],
                        runtime: {
                            autostart: stageDefinition.taskLaunchPolicy.defaultAutostart
                        },
                        ...(task.agentRunner ? { agentRunner: task.agentRunner } : {}),
                        retries: 0,
                        reworkIterationCount: 0,
                        createdAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }));
                this.state.tasks = [...this.state.tasks, ...createdTasks];
                return;
            }
            case 'task.launch-policy.changed':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            runtime: {
                                ...task.runtime,
                                autostart: event.autostart
                            },
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                return;
            case 'task.queued':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            lifecycle: 'queued',
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                if (!this.state.launchQueue.some((request) => request.taskId === event.taskId)) {
                    this.state.launchQueue.push({
                        requestId: `task.launch:${event.taskId}:${event.occurredAt}`,
                        taskId: event.taskId,
                        requestedAt: event.occurredAt,
                        requestedBy: event.source === 'human' ? 'human' : event.source === 'daemon' ? 'daemon' : 'system',
                        causedByEventId: event.eventId,
                        ...(event.runnerId ? { runnerId: event.runnerId } : {}),
                        ...(event.prompt ? { prompt: event.prompt } : {}),
                        ...(event.workingDirectory ? { workingDirectory: event.workingDirectory } : {}),
                        ...(event.terminalSessionName ? { terminalSessionName: event.terminalSessionName } : {})
                    });
                }
                return;
            case 'task.started':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            lifecycle: 'running',
                            startedAt: task.startedAt ?? event.occurredAt,
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                return;
            case 'task.completed':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            lifecycle: 'completed',
                            completedAt: event.occurredAt,
                            ...(task.reworkRequest && !task.reworkRequest.resolvedAt
                                ? {
                                    reworkRequest: {
                                        ...task.reworkRequest,
                                        resolvedAt: event.occurredAt
                                    }
                                }
                                : {}),
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                return;
            case 'task.reopened': {
                const reopenedTask = this.state.tasks.find((candidate) => candidate.taskId === event.taskId);
                const resetTaskIds = reopenedTask
                    ? new Set([reopenedTask.taskId, ...resolveDependentTaskIds(this.state.tasks, reopenedTask.taskId)])
                    : new Set<string>();

                this.state.tasks = this.state.tasks.map((task) => {
                    const shouldReset = resetTaskIds.has(task.taskId);

                    if (!shouldReset) {
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

                this.state.launchQueue = this.state.launchQueue.filter((request) => {
                    return !resetTaskIds.has(request.taskId);
                });
                return;
            }
            case 'task.reworked': {
                const reworkedTask = this.state.tasks.find((candidate) => candidate.taskId === event.taskId);
                const resetTaskIds = reworkedTask
                    ? new Set([reworkedTask.taskId, ...resolveDependentTaskIds(this.state.tasks, reworkedTask.taskId)])
                    : new Set<string>();

                this.state.tasks = this.state.tasks.map((task) => {
                    if (!resetTaskIds.has(task.taskId)) {
                        return task;
                    }

                    const resetTask = resetLifecycleState(task, event.occurredAt);
                    if (task.taskId !== event.taskId) {
                        return resetTask;
                    }

                    const iteration = (task.reworkIterationCount ?? 0) + 1;
                    const reworkRequest = {
                        requestId: `task.reworked:${event.taskId}:${event.occurredAt}`,
                        requestedAt: event.occurredAt,
                        actor: event.actor,
                        reasonCode: event.reasonCode,
                        summary: event.summary,
                        iteration,
                        maxIterations: resolveTaskMaxReworkIterations(task),
                        ...(event.sourceTaskId ? { sourceTaskId: event.sourceTaskId } : {}),
                        ...(event.sourceSessionId ? { sourceSessionId: event.sourceSessionId } : {}),
                        artifactRefs: event.artifactRefs.map((artifactRef) => ({ ...artifactRef }))
                    };
                    const reworkedRuntimeTask: MissionTaskRuntimeState = {
                        ...resetTask,
                        reworkIterationCount: iteration,
                        reworkRequest
                    };
                    const pendingLaunchContext = buildReworkPendingLaunchContext(reworkedRuntimeTask);

                    return {
                        ...reworkedRuntimeTask,
                        ...(pendingLaunchContext ? { pendingLaunchContext } : {})
                    };
                });

                this.state.launchQueue = this.state.launchQueue.filter((request) => !resetTaskIds.has(request.taskId));
                return;
            }
            case 'session.started': {
                this.state.tasks = this.state.tasks.map((task) => {
                    if (task.taskId !== event.taskId) {
                        return task;
                    }

                    const { pendingLaunchContext, ...rest } = task;
                    void pendingLaunchContext;
                    return {
                        ...rest,
                        lifecycle: 'running',
                        ...(task.reworkRequest && !task.reworkRequest.launchedAt
                            ? {
                                reworkRequest: {
                                    ...task.reworkRequest,
                                    launchedAt: event.occurredAt
                                }
                            }
                            : {}),
                        updatedAt: event.occurredAt
                    };
                });
                this.state.sessions = upsertSession(this.state.sessions, {
                    sessionId: event.sessionId,
                    taskId: event.taskId,
                    runnerId: event.runnerId,
                    ...(event.transportId ? { transportId: event.transportId } : {}),
                    ...(event.sessionLogPath ? { sessionLogPath: event.sessionLogPath } : {}),
                    ...(event.terminalSessionName ? { terminalSessionName: event.terminalSessionName } : {}),
                    ...(event.terminalPaneId ? { terminalPaneId: event.terminalPaneId } : {}),
                    lifecycle: 'running',
                    launchedAt: event.occurredAt,
                    updatedAt: event.occurredAt
                });
                this.state.launchQueue = this.state.launchQueue.filter((request) => request.taskId !== event.taskId);
                return;
            }
            case 'session.launch-failed':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            lifecycle: 'failed',
                            failedAt: event.occurredAt,
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                this.state.launchQueue = this.state.launchQueue.filter((request) => request.taskId !== event.taskId);
                return;
            case 'session.completed':
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'completed', event.occurredAt);
                return;
            case 'session.failed': {
                const wasActive = hasActiveSession(this.state.sessions, event.sessionId);
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'failed', event.occurredAt);
                if (!wasActive) {
                    return;
                }
                this.state.tasks = this.state.tasks.map((task) =>
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
            }
            case 'session.cancelled': {
                const wasActive = hasActiveSession(this.state.sessions, event.sessionId);
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'cancelled', event.occurredAt);
                if (!wasActive) {
                    return;
                }
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? resetInterruptedTask(task, event.occurredAt)
                        : task
                );
                return;
            }
            case 'session.terminated': {
                const wasActive = hasActiveSession(this.state.sessions, event.sessionId);
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'terminated', event.occurredAt);
                if (!wasActive) {
                    return;
                }
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? resetInterruptedTask(task, event.occurredAt)
                        : task
                );
                return;
            }
        }
    }
}

class MissionWorkflowDerivationEngine {
    public constructor(
        private readonly state: MissionWorkflowRuntimeState,
        private readonly event: MissionWorkflowEvent,
        private readonly configuration: MissionWorkflowConfigurationSnapshot,
        private readonly signals: MissionWorkflowSignal[],
        private readonly requests: MissionWorkflowRequest[],
        private readonly suppressAutostart: boolean
    ) { }

    public derive(): void {
        const event = this.event;
        enforceLifecycleInvariants(this.state, this.configuration, event.occurredAt);
        applyDerivedWorkflowProjectionState(this.state, this.configuration, event.occurredAt);
        if (!this.suppressAutostart) {
            queueAutostartTasks(this.state, event, this.configuration, this.requests);
        }
        applyDerivedWorkflowProjectionState(this.state, this.configuration, event.occurredAt);

        if (this.state.lifecycle !== 'delivered' && isMissionCompleted(this.state, this.configuration)) {
            if (this.state.lifecycle !== 'completed') {
                this.state.lifecycle = 'completed';
                this.signals.push(createSignal('mission.completed', event.occurredAt, {}));
                this.signals.push(createSignal('mission.delivered-ready', event.occurredAt, {}));
            }
        }

        for (const stage of this.state.stages) {
            if (stage.lifecycle === 'ready') {
                this.signals.push(createSignal('stage.ready', event.occurredAt, { stageId: stage.stageId }));
            }
            if (stage.lifecycle === 'completed') {
                this.signals.push(createSignal('stage.completed', event.occurredAt, { stageId: stage.stageId }));
            }
        }

        for (const task of this.state.tasks) {
            if (task.lifecycle === 'ready') {
                this.signals.push(createSignal('task.ready', event.occurredAt, { taskId: task.taskId, stageId: task.stageId }));
            }
        }

        for (const gate of this.state.gates) {
            this.signals.push(createSignal(gate.state === 'passed' ? 'gate.passed' : 'gate.blocked', event.occurredAt, {
                gateId: gate.gateId,
                state: gate.state,
                ...(gate.stageId ? { stageId: gate.stageId } : {})
            }));
        }

        this.requests.push(...buildWorkflowTaskGenerationRequests(this.state, this.configuration, event.occurredAt));

        if (this.state.panic.active && this.state.panic.terminateSessions) {
            for (const session of this.state.sessions) {
                if (isActiveSessionLifecycle(session.lifecycle)) {
                    this.requests.push(createRequest('session.terminate', event.occurredAt, {
                        sessionId: session.sessionId,
                        taskId: session.taskId,
                        runnerId: session.runnerId
                    }));
                }
            }
        }

        this.state.updatedAt = event.occurredAt;
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
    _configuration: MissionWorkflowConfigurationSnapshot,
    requests: MissionWorkflowRequest[]
): void {
    if (state.lifecycle !== 'running' || state.pause.paused || state.panic.active) {
        return;
    }

    let occupiedTaskSlots = countOccupiedTaskExecutionSlots(state);
    const queuedLaunchTaskIds = new Set(state.launchQueue.map((request) => request.taskId));
    const activeSessionTaskIds = new Set(
        state.sessions
            .filter((session) => isActiveSessionLifecycle(session.lifecycle))
            .map((session) => session.taskId)
    );

    for (const task of state.tasks) {
        if (task.lifecycle !== 'ready' || !task.runtime.autostart) {
            continue;
        }
        if (occupiedTaskSlots >= _configuration.workflow.execution.maxParallelTasks) {
            break;
        }
        if (queuedLaunchTaskIds.has(task.taskId) || activeSessionTaskIds.has(task.taskId)) {
            continue;
        }
        task.lifecycle = 'queued';
        task.updatedAt = event.occurredAt;
        state.launchQueue.push({
            requestId: `task.launch:${task.taskId}:${event.occurredAt}`,
            taskId: task.taskId,
            requestedAt: event.occurredAt,
            requestedBy: event.source === 'human' ? 'human' : event.source === 'daemon' ? 'daemon' : 'system',
            causedByEventId: event.eventId
        });
        queuedLaunchTaskIds.add(task.taskId);
        occupiedTaskSlots += 1;
    }

    let occupiedSessionSlots = countOccupiedSessionExecutionSlots(state);
    for (const launchRequest of state.launchQueue) {
        if (launchRequest.dispatchedAt || activeSessionTaskIds.has(launchRequest.taskId)) {
            continue;
        }
        if (occupiedSessionSlots >= _configuration.workflow.execution.maxParallelSessions) {
            break;
        }
        const request = createRequest('session.launch', event.occurredAt, {
            taskId: launchRequest.taskId,
            ...(launchRequest.runnerId ? { runnerId: launchRequest.runnerId } : {}),
            ...(launchRequest.prompt ? { prompt: launchRequest.prompt } : {}),
            ...(launchRequest.workingDirectory ? { workingDirectory: launchRequest.workingDirectory } : {}),
            ...(launchRequest.terminalSessionName ? { terminalSessionName: launchRequest.terminalSessionName } : {})
        });
        launchRequest.dispatchedAt = event.occurredAt;
        launchRequest.requestId = request.requestId;
        requests.push(request);
        occupiedSessionSlots += 1;
    }
}

function upsertSession(
    sessions: AgentSessionRuntimeState[],
    session: AgentSessionRuntimeState
): AgentSessionRuntimeState[] {
    const existingIndex = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
    if (existingIndex < 0) {
        return [...sessions, session];
    }
    const next = [...sessions];
    next[existingIndex] = session;
    return next;
}

function updateSessionLifecycle(
    sessions: AgentSessionRuntimeState[],
    sessionId: string,
    lifecycle: AgentSessionRuntimeState['lifecycle'],
    occurredAt: string
): AgentSessionRuntimeState[] {
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

function hasActiveSession(sessions: AgentSessionRuntimeState[], sessionId: string): boolean {
    return sessions.some((session) => session.sessionId === sessionId && isActiveSessionLifecycle(session.lifecycle));
}

function isInactiveSessionLifecycleEvent(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent
): boolean {
    switch (event.type) {
        case 'session.cancelled':
        case 'session.terminated':
            return true;
        case 'session.failed':
            return !hasActiveSession(state.sessions, event.sessionId);
        default:
            return false;
    }
}

function applyDerivedWorkflowProjectionState(
    state: MissionWorkflowRuntimeState,
    configuration: MissionWorkflowConfigurationSnapshot,
    occurredAt: string
): void {
    const derived = deriveMissionWorkflowProjectionState(state, configuration, occurredAt);
    state.tasks = derived.tasks;
    state.stages = derived.stages;
    state.gates = derived.gates;
    assignActiveStageId(state, derived.activeStageId);
}

function resetInterruptedTask(task: MissionTaskRuntimeState, occurredAt: string): MissionTaskRuntimeState {
    const resetTask = resetLifecycleState(task, occurredAt);
    return {
        ...resetTask,
        runtime: {
            ...resetTask.runtime,
            autostart: false
        }
    };
}

function resetLifecycleState(task: MissionTaskRuntimeState, occurredAt: string): MissionTaskRuntimeState {
    const { completedAt, failedAt, cancelledAt, ...rest } = task;
    void completedAt;
    void failedAt;
    void cancelledAt;
    return {
        ...rest,
        lifecycle: 'pending',
        updatedAt: occurredAt
    };
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
            completedTaskIds: [...stage.completedTaskIds]
        })),
        tasks: state.tasks.map((task) => ({
            ...task,
            dependsOn: [...task.dependsOn],
            waitingOnTaskIds: [...task.waitingOnTaskIds],
            runtime: { ...task.runtime },
            ...(task.reworkRequest
                ? {
                    reworkRequest: {
                        ...task.reworkRequest,
                        artifactRefs: task.reworkRequest.artifactRefs.map((artifactRef) => ({ ...artifactRef }))
                    }
                }
                : {}),
            ...(task.pendingLaunchContext
                ? {
                    pendingLaunchContext: {
                        ...task.pendingLaunchContext,
                        artifactRefs: task.pendingLaunchContext.artifactRefs.map((artifactRef) => ({ ...artifactRef }))
                    }
                }
                : {})
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
