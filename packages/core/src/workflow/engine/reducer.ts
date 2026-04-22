import {
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionWorkflowReducer,
    type MissionWorkflowReducerResult,
    type MissionWorkflowRuntimeState,
    type MissionWorkflowSignal,
    type MissionTaskRuntimeState,
    type MissionAgentSessionRuntimeState
} from './types.js';
import { createInitialMissionWorkflowRuntimeState } from './document.js';
import {
    buildWorkflowTaskGenerationRequests,
    countOccupiedSessionExecutionSlots,
    countOccupiedTaskExecutionSlots,
    isActiveSessionLifecycle,
    isMissionCompleted
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
        new MissionWorkflowTransitionEngine(this.state, this.event, this.configuration).apply();
        new MissionWorkflowDerivationEngine(this.state, this.event, this.configuration, this.signals, this.requests).derive();
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
                        dependsOn: [...task.dependsOn],
                        lifecycle: 'pending',
                        waitingOnTaskIds: [],
                        runtime: {
                            autostart: stageDefinition.taskLaunchPolicy.defaultAutostart
                        },
                        ...(task.agentRunner ? { agentRunner: task.agentRunner } : {}),
                        retries: 0,
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
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                return;
            case 'task.reopened': {
                const stageOrder = this.configuration.workflow.stageOrder;
                const reopenedTask = this.state.tasks.find((candidate) => candidate.taskId === event.taskId);
                const reopenedStageIndex = reopenedTask ? stageOrder.indexOf(reopenedTask.stageId) : -1;

                this.state.tasks = this.state.tasks.map((task) => {
                    const taskStageIndex = stageOrder.indexOf(task.stageId);
                    const shouldReset = task.taskId === event.taskId || (reopenedStageIndex >= 0 && taskStageIndex > reopenedStageIndex);

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
                    if (!reopenedTask) {
                        return true;
                    }
                    const queueTask = this.state.tasks.find((candidate) => candidate.taskId === request.taskId);
                    if (!queueTask) {
                        return true;
                    }
                    return stageOrder.indexOf(queueTask.stageId) <= reopenedStageIndex;
                });
                return;
            }
            case 'session.started': {
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            lifecycle: 'running',
                            updatedAt: event.occurredAt
                        }
                        : task
                );
                this.state.sessions = upsertSession(this.state.sessions, {
                    sessionId: event.sessionId,
                    taskId: event.taskId,
                    runnerId: event.runnerId,
                    ...(event.transportId ? { transportId: event.transportId } : {}),
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
            case 'session.failed':
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'failed', event.occurredAt);
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
            case 'session.cancelled':
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'cancelled', event.occurredAt);
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? resetInterruptedTask(task, event.occurredAt)
                        : task
                );
                return;
            case 'session.terminated':
                this.state.sessions = updateSessionLifecycle(this.state.sessions, event.sessionId, 'terminated', event.occurredAt);
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? resetInterruptedTask(task, event.occurredAt)
                        : task
                );
                return;
        }
    }
}

class MissionWorkflowDerivationEngine {
    public constructor(
        private readonly state: MissionWorkflowRuntimeState,
        private readonly event: MissionWorkflowEvent,
        private readonly configuration: MissionWorkflowConfigurationSnapshot,
        private readonly signals: MissionWorkflowSignal[],
        private readonly requests: MissionWorkflowRequest[]
    ) { }

    public derive(): void {
        const event = this.event;
        enforceLifecycleInvariants(this.state, this.configuration, event.occurredAt);
        applyDerivedWorkflowProjectionState(this.state, this.configuration, event.occurredAt);
        queueAutostartTasks(this.state, event, this.configuration, this.requests);
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
