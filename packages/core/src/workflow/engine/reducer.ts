import {
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionWorkflowReducer,
    type MissionWorkflowReducerResult,
    type MissionWorkflowRuntimeState,
    type MissionWorkflowSignal,
    type MissionTaskRuntimeState,
    type AgentExecutionRuntimeState
} from './types.js';
import { createInitialMissionWorkflowRuntimeState } from './document.js';
import {
    buildReworkPendingLaunchContext,
    buildWorkflowTaskGenerationRequests,
    countOccupiedAgentExecutionSlots,
    countOccupiedTaskExecutionSlots,
    isActiveAgentExecutionLifecycle,
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
        const suppressAutostart = isInactiveAgentExecutionLifecycleEvent(this.state, this.event);
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
                        ...(existing?.agentId ? { agentId: existing.agentId } : {}),
                        ...(existing?.prompt ? { prompt: existing.prompt } : {}),
                        ...(existing?.workingDirectory ? { workingDirectory: existing.workingDirectory } : {}),
                        ...(existing?.terminalName ? { terminalName: existing.terminalName } : {})
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
                        ...(task.model ? { model: task.model } : {}),
                        ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
                        ...(task.taskKind ? { taskKind: task.taskKind } : {}),
                        ...(task.pairedTaskId ? { pairedTaskId: task.pairedTaskId } : {}),
                        dependsOn: [...task.dependsOn],
                        context: task.context ? task.context.map((contextArtifact) => ({ ...contextArtifact })) : [],
                        lifecycle: 'pending',
                        waitingOnTaskIds: [],
                        runtime: {
                            autostart: stageDefinition.taskLaunchPolicy.defaultAutostart
                        },
                        ...(task.agentAdapter ? { agentAdapter: task.agentAdapter } : {}),
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
            case 'task.configured':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? configureTaskRuntimeState(task, event)
                        : task
                );
                return;
            case 'task.queued':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? {
                            ...task,
                            ...(event.agentId ? { agentAdapter: event.agentId } : {}),
                            ...(event.model ? { model: event.model } : {}),
                            ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
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
                        ...(event.agentId ? { agentId: event.agentId } : {}),
                        ...(event.prompt ? { prompt: event.prompt } : {}),
                        ...(event.workingDirectory ? { workingDirectory: event.workingDirectory } : {}),
                        ...(event.model ? { model: event.model } : {}),
                        ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
                        ...(event.terminalName ? { terminalName: event.terminalName } : {})
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
            case 'task.cancelled':
                this.state.tasks = this.state.tasks.map((task) =>
                    task.taskId === event.taskId
                        ? resetInterruptedTask(task, event.occurredAt)
                        : task
                );
                this.state.launchQueue = this.state.launchQueue.filter((request) => request.taskId !== event.taskId);
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
                        ...(event.sourceAgentExecutionId ? { sourceAgentExecutionId: event.sourceAgentExecutionId } : {}),
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
            case 'execution.started': {
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
                this.state.agentExecutions = upsertAgentExecution(this.state.agentExecutions, {
                    agentExecutionId: event.agentExecutionId,
                    taskId: event.taskId,
                    agentId: event.agentId,
                    ...(event.transportId ? { transportId: event.transportId } : {}),
                    ...(event.agentJournalPath ? { agentJournalPath: event.agentJournalPath } : {}),
                    ...(event.terminalRecordingPath ? { terminalRecordingPath: event.terminalRecordingPath } : {}),
                    ...(event.terminalHandle ? { terminalHandle: { ...event.terminalHandle } } : {}),
                    lifecycle: 'running',
                    launchedAt: event.occurredAt,
                    updatedAt: event.occurredAt
                });
                this.state.launchQueue = this.state.launchQueue.filter((request) => request.taskId !== event.taskId);
                return;
            }
            case 'execution.launch-failed':
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
            case 'execution.completed':
                this.state.agentExecutions = updateAgentExecutionLifecycle(this.state.agentExecutions, event.agentExecutionId, 'completed', event.occurredAt);
                return;
            case 'execution.failed': {
                const wasActive = hasActiveAgentExecution(this.state.agentExecutions, event.agentExecutionId);
                this.state.agentExecutions = updateAgentExecutionLifecycle(this.state.agentExecutions, event.agentExecutionId, 'failed', event.occurredAt);
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
            case 'execution.cancelled': {
                const wasActive = hasActiveAgentExecution(this.state.agentExecutions, event.agentExecutionId);
                this.state.agentExecutions = updateAgentExecutionLifecycle(this.state.agentExecutions, event.agentExecutionId, 'cancelled', event.occurredAt);
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
            case 'execution.terminated': {
                const wasActive = hasActiveAgentExecution(this.state.agentExecutions, event.agentExecutionId);
                this.state.agentExecutions = updateAgentExecutionLifecycle(this.state.agentExecutions, event.agentExecutionId, 'terminated', event.occurredAt);
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
    void configuration;
    switch (state.lifecycle) {
        case 'running':
            state.pause = { paused: false };
            return;
        case 'paused':
            state.pause = {
                paused: true,
                reason: state.pause.reason ?? 'human-requested',
                ...(state.pause.targetType ? { targetType: state.pause.targetType } : {}),
                ...(state.pause.targetId ? { targetId: state.pause.targetId } : {}),
                requestedAt: state.pause.requestedAt ?? occurredAt
            };
            return;
        default:
            state.pause = { paused: false };
    }
}

function queueAutostartTasks(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent,
    _configuration: MissionWorkflowConfigurationSnapshot,
    requests: MissionWorkflowRequest[]
): void {
    if (state.lifecycle !== 'running' || state.pause.paused) {
        return;
    }

    let occupiedTaskSlots = countOccupiedTaskExecutionSlots(state);
    const queuedLaunchTaskIds = new Set(state.launchQueue.map((request) => request.taskId));
    const activeAgentExecutionTaskIds = new Set(
        state.agentExecutions
            .filter((execution) => isActiveAgentExecutionLifecycle(execution.lifecycle))
            .map((execution) => execution.taskId)
    );

    for (const task of state.tasks) {
        if (task.lifecycle !== 'ready' || !task.runtime.autostart) {
            continue;
        }
        if (occupiedTaskSlots >= _configuration.workflow.execution.maxParallelTasks) {
            break;
        }
        if (queuedLaunchTaskIds.has(task.taskId) || activeAgentExecutionTaskIds.has(task.taskId)) {
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

    let occupiedAgentExecutionSlots = countOccupiedAgentExecutionSlots(state);
    for (const launchRequest of state.launchQueue) {
        if (launchRequest.dispatchedAt || activeAgentExecutionTaskIds.has(launchRequest.taskId)) {
            continue;
        }
        if (occupiedAgentExecutionSlots >= _configuration.workflow.execution.maxParallelAgentExecutions) {
            break;
        }
        const request = createRequest('execution.launch', event.occurredAt, {
            taskId: launchRequest.taskId,
            ...(launchRequest.agentId ? { agentId: launchRequest.agentId } : {}),
            ...(launchRequest.prompt ? { prompt: launchRequest.prompt } : {}),
            ...(launchRequest.workingDirectory ? { workingDirectory: launchRequest.workingDirectory } : {}),
            ...(launchRequest.model ? { model: launchRequest.model } : {}),
            ...(launchRequest.reasoningEffort ? { reasoningEffort: launchRequest.reasoningEffort } : {}),
            ...(launchRequest.terminalName ? { terminalName: launchRequest.terminalName } : {})
        });
        launchRequest.dispatchedAt = event.occurredAt;
        launchRequest.requestId = request.requestId;
        requests.push(request);
        occupiedAgentExecutionSlots += 1;
    }
}

function upsertAgentExecution(
    agentExecutions: AgentExecutionRuntimeState[],
    AgentExecution: AgentExecutionRuntimeState
): AgentExecutionRuntimeState[] {
    const existingIndex = agentExecutions.findIndex((candidate) => candidate.agentExecutionId === AgentExecution.agentExecutionId);
    if (existingIndex < 0) {
        return [...agentExecutions, AgentExecution];
    }
    const next = [...agentExecutions];
    next[existingIndex] = AgentExecution;
    return next;
}

function updateAgentExecutionLifecycle(
    agentExecutions: AgentExecutionRuntimeState[],
    agentExecutionId: string,
    lifecycle: AgentExecutionRuntimeState['lifecycle'],
    occurredAt: string
): AgentExecutionRuntimeState[] {
    return agentExecutions.map((AgentExecution) =>
        AgentExecution.agentExecutionId === agentExecutionId
            ? {
                ...AgentExecution,
                lifecycle,
                updatedAt: occurredAt,
                ...(lifecycle === 'completed' ? { completedAt: occurredAt } : {}),
                ...(lifecycle === 'failed' ? { failedAt: occurredAt } : {}),
                ...(lifecycle === 'cancelled' ? { cancelledAt: occurredAt } : {}),
                ...(lifecycle === 'terminated' ? { terminatedAt: occurredAt } : {})
            }
            : AgentExecution
    );
}

function hasActiveAgentExecution(agentExecutions: AgentExecutionRuntimeState[], agentExecutionId: string): boolean {
    return agentExecutions.some((execution) => execution.agentExecutionId === agentExecutionId && isActiveAgentExecutionLifecycle(execution.lifecycle));
}

function isInactiveAgentExecutionLifecycleEvent(
    state: MissionWorkflowRuntimeState,
    event: MissionWorkflowEvent
): boolean {
    switch (event.type) {
        case 'execution.cancelled':
        case 'execution.terminated':
            return true;
        case 'execution.failed':
            return !hasActiveAgentExecution(state.agentExecutions, event.agentExecutionId);
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
            ...(task.context ? { context: task.context.map((contextArtifact) => ({ ...contextArtifact })) } : {}),
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
        agentExecutions: state.agentExecutions.map((AgentExecution) => ({ ...AgentExecution })),
        gates: state.gates.map((gate) => ({ ...gate, reasons: [...gate.reasons] })),
        launchQueue: state.launchQueue.map((request) => ({ ...request })),
        updatedAt: state.updatedAt
    };
}

function configureTaskRuntimeState(
    task: MissionTaskRuntimeState,
    event: Extract<MissionWorkflowEvent, { type: 'task.configured' }>
): MissionTaskRuntimeState {
    const next: MissionTaskRuntimeState = {
        ...task,
        updatedAt: event.occurredAt
    };
    if (event.agentAdapter?.trim()) {
        next.agentAdapter = event.agentAdapter.trim();
    }
    if (Object.prototype.hasOwnProperty.call(event, 'model')) {
        if (event.model?.trim()) {
            next.model = event.model.trim();
        } else {
            delete next.model;
        }
    }
    if (Object.prototype.hasOwnProperty.call(event, 'reasoningEffort')) {
        if (event.reasoningEffort) {
            next.reasoningEffort = event.reasoningEffort;
        } else {
            delete next.reasoningEffort;
        }
    }
    if (typeof event.autostart === 'boolean') {
        next.runtime = {
            ...next.runtime,
            autostart: event.autostart
        };
    }
    if (event.context) {
        next.context = event.context.map((contextArtifact) => ({ ...contextArtifact }));
    }
    return next;
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
