export type MissionStageId = string;

export const MISSION_LIFECYCLE_STATES = [
    'draft',
    'ready',
    'running',
    'paused',
    'panicked',
    'completed',
    'delivered'
] as const;

export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

export const MISSION_STAGE_DERIVED_STATES = [
    'pending',
    'ready',
    'active',
    'completed'
] as const;

export type MissionStageDerivedState = (typeof MISSION_STAGE_DERIVED_STATES)[number];

export const MISSION_TASK_LIFECYCLE_STATES = [
    'pending',
    'ready',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled'
] as const;

export type MissionTaskLifecycleState = (typeof MISSION_TASK_LIFECYCLE_STATES)[number];

export type MissionPauseReason =
    | 'human-requested'
    | 'panic'
    | 'checkpoint'
    | 'agent-failure'
    | 'system';

export const MISSION_AGENT_SESSION_LIFECYCLE_STATES = [
    'starting',
    'running',
    'completed',
    'failed',
    'cancelled',
    'terminated'
] as const;

export type MissionAgentSessionLifecycleState = (typeof MISSION_AGENT_SESSION_LIFECYCLE_STATES)[number];

export type MissionGateIntent = 'implement' | 'verify' | 'audit' | 'deliver';
export type MissionGateState = 'blocked' | 'passed';

export interface MissionTaskRuntimeSettings {
    autostart: boolean;
}

export interface MissionTaskRuntimeState {
    taskId: string;
    stageId: MissionStageId;
    title: string;
    instruction: string;
    dependsOn: string[];
    lifecycle: MissionTaskLifecycleState;
    waitingOnTaskIds: string[];
    runtime: MissionTaskRuntimeSettings;
    agentRunner?: string;
    retries: number;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    failedAt?: string;
    cancelledAt?: string;
}

export interface MissionPauseState {
    paused: boolean;
    reason?: MissionPauseReason;
    targetType?: 'mission' | 'task' | 'session';
    targetId?: string;
    requestedAt?: string;
}

export interface MissionPanicState {
    active: boolean;
    requestedAt?: string;
    requestedBy?: 'human' | 'system';
    terminateSessions: boolean;
    clearLaunchQueue: boolean;
    haltMission: boolean;
}

export interface MissionTaskLaunchRequest {
    requestId: string;
    taskId: string;
    requestedAt: string;
    requestedBy: 'system' | 'human' | 'daemon';
    causedByEventId?: string;
    runnerId?: string;
    prompt?: string;
    workingDirectory?: string;
    terminalSessionName?: string;
    dispatchedAt?: string;
}

export interface MissionStageRuntimeProjection {
    stageId: MissionStageId;
    lifecycle: MissionStageDerivedState;
    taskIds: string[];
    readyTaskIds: string[];
    queuedTaskIds: string[];
    runningTaskIds: string[];
    completedTaskIds: string[];
    enteredAt?: string;
    completedAt?: string;
}

export interface MissionAgentSessionRuntimeState {
    sessionId: string;
    taskId: string;
    runnerId: string;
    transportId?: string;
    terminalSessionName?: string;
    terminalPaneId?: string;
    lifecycle: MissionAgentSessionLifecycleState;
    launchedAt: string;
    updatedAt: string;
    completedAt?: string;
    failedAt?: string;
    cancelledAt?: string;
    terminatedAt?: string;
}

export interface MissionGateProjection {
    gateId: string;
    intent: MissionGateIntent;
    state: MissionGateState;
    stageId?: MissionStageId;
    reasons: string[];
    updatedAt: string;
}

export interface WorkflowMissionAutostartSettings {
    mission: boolean;
}

export interface WorkflowHumanInLoopSettings {
    enabled: boolean;
    pauseOnMissionStart: boolean;
}

export interface WorkflowPanicSettings {
    terminateSessions: boolean;
    clearLaunchQueue: boolean;
    haltMission: boolean;
}

export interface WorkflowExecutionSettings {
    maxParallelTasks: number;
    maxParallelSessions: number;
}

export interface WorkflowStageTaskLaunchPolicy {
    defaultAutostart: boolean;
}

export interface WorkflowStageDefinition {
    stageId: MissionStageId;
    displayName: string;
    taskLaunchPolicy: WorkflowStageTaskLaunchPolicy;
}

export interface WorkflowGeneratedTaskDefinition {
    taskId: string;
    title: string;
    instruction: string;
    dependsOn: string[];
    agentRunner?: string;
}

export interface WorkflowTaskTemplateSource {
    templateId: string;
    path: string;
}

export interface WorkflowTaskGenerationRule {
    stageId: MissionStageId;
    artifactTasks: boolean;
    templateSources: WorkflowTaskTemplateSource[];
    tasks: WorkflowGeneratedTaskDefinition[];
}

export interface WorkflowGateDefinition {
    gateId: string;
    intent: MissionGateIntent;
    stageId?: MissionStageId;
}

export interface WorkflowGlobalSettings {
    autostart: WorkflowMissionAutostartSettings;
    humanInLoop: WorkflowHumanInLoopSettings;
    panic: WorkflowPanicSettings;
    execution: WorkflowExecutionSettings;
    stageOrder: MissionStageId[];
    stages: Record<MissionStageId, WorkflowStageDefinition>;
    taskGeneration: WorkflowTaskGenerationRule[];
    gates: WorkflowGateDefinition[];
}

export interface MissionWorkflowConfigurationSnapshot {
    createdAt: string;
    source: 'global-settings';
    workflowVersion: string;
    workflow: WorkflowGlobalSettings;
}

export interface MissionWorkflowRuntimeState {
    lifecycle: MissionLifecycleState;
    activeStageId?: MissionStageId;
    pause: MissionPauseState;
    panic: MissionPanicState;
    stages: MissionStageRuntimeProjection[];
    tasks: MissionTaskRuntimeState[];
    sessions: MissionAgentSessionRuntimeState[];
    gates: MissionGateProjection[];
    launchQueue: MissionTaskLaunchRequest[];
    updatedAt: string;
}

export interface MissionWorkflowEventBase {
    eventId: string;
    type: string;
    occurredAt: string;
    source: 'system' | 'human' | 'agent' | 'daemon';
    causedByRequestId?: string;
}

export interface MissionGeneratedTaskPayload {
    taskId: string;
    title: string;
    instruction: string;
    dependsOn: string[];
    agentRunner?: string;
}

export interface MissionCreatedEvent extends MissionWorkflowEventBase {
    type: 'mission.created';
}

export interface MissionStartedEvent extends MissionWorkflowEventBase {
    type: 'mission.started';
}

export interface MissionResumedEvent extends MissionWorkflowEventBase {
    type: 'mission.resumed';
}

export interface MissionPausedEvent extends MissionWorkflowEventBase {
    type: 'mission.paused';
    reason: MissionPauseReason;
    targetType?: 'mission' | 'task' | 'session';
    targetId?: string;
}

export interface PanicStopRequestedEvent extends MissionWorkflowEventBase {
    type: 'mission.panic.requested';
}

export interface PanicStopClearedEvent extends MissionWorkflowEventBase {
    type: 'mission.panic.cleared';
}

export interface MissionLaunchQueueRestartedEvent extends MissionWorkflowEventBase {
    type: 'mission.launch-queue.restarted';
}

export interface MissionDeliveredEvent extends MissionWorkflowEventBase {
    type: 'mission.delivered';
}

export interface TasksGeneratedEvent extends MissionWorkflowEventBase {
    type: 'tasks.generated';
    stageId: MissionStageId;
    tasks: MissionGeneratedTaskPayload[];
}

export interface TaskLaunchPolicyChangedEvent extends MissionWorkflowEventBase {
    type: 'task.launch-policy.changed';
    taskId: string;
    autostart: boolean;
}

export interface TaskQueuedEvent extends MissionWorkflowEventBase {
    type: 'task.queued';
    taskId: string;
    runnerId?: string;
    prompt?: string;
    workingDirectory?: string;
    terminalSessionName?: string;
}

export interface TaskStartedEvent extends MissionWorkflowEventBase {
    type: 'task.started';
    taskId: string;
}

export interface TaskMarkedDoneEvent extends MissionWorkflowEventBase {
    type: 'task.completed';
    taskId: string;
}

export interface TaskReopenedEvent extends MissionWorkflowEventBase {
    type: 'task.reopened';
    taskId: string;
}

export interface AgentSessionStartedEvent extends MissionWorkflowEventBase {
    type: 'session.started';
    sessionId: string;
    taskId: string;
    runnerId: string;
    transportId?: string;
    terminalSessionName?: string;
    terminalPaneId?: string;
}

export interface AgentSessionLaunchFailedEvent extends MissionWorkflowEventBase {
    type: 'session.launch-failed';
    taskId: string;
    reason?: string;
}

export interface AgentSessionCompletedEvent extends MissionWorkflowEventBase {
    type: 'session.completed';
    sessionId: string;
    taskId: string;
}

export interface AgentSessionFailedEvent extends MissionWorkflowEventBase {
    type: 'session.failed';
    sessionId: string;
    taskId: string;
}

export interface AgentSessionCancelledEvent extends MissionWorkflowEventBase {
    type: 'session.cancelled';
    sessionId: string;
    taskId: string;
}

export interface AgentSessionTerminatedEvent extends MissionWorkflowEventBase {
    type: 'session.terminated';
    sessionId: string;
    taskId: string;
}

export type MissionWorkflowEvent =
    | MissionCreatedEvent
    | MissionStartedEvent
    | MissionResumedEvent
    | MissionPausedEvent
    | PanicStopRequestedEvent
    | PanicStopClearedEvent
    | MissionLaunchQueueRestartedEvent
    | MissionDeliveredEvent
    | TasksGeneratedEvent
    | TaskLaunchPolicyChangedEvent
    | TaskQueuedEvent
    | TaskStartedEvent
    | TaskMarkedDoneEvent
    | TaskReopenedEvent
    | AgentSessionStartedEvent
    | AgentSessionLaunchFailedEvent
    | AgentSessionCompletedEvent
    | AgentSessionFailedEvent
    | AgentSessionCancelledEvent
    | AgentSessionTerminatedEvent;

export interface MissionWorkflowEventRecord {
    eventId: string;
    type: string;
    occurredAt: string;
    source: 'system' | 'human' | 'agent' | 'daemon';
    causedByRequestId?: string;
    payload: Record<string, unknown>;
}

export interface MissionWorkflowSignal {
    signalId: string;
    type:
    | 'stage.ready'
    | 'stage.completed'
    | 'task.ready'
    | 'gate.passed'
    | 'gate.blocked'
    | 'mission.completed'
    | 'mission.delivered-ready';
    emittedAt: string;
    payload: Record<string, unknown>;
}

export interface MissionWorkflowRequest {
    requestId: string;
    type:
    | 'tasks.request-generation'
    | 'session.launch'
    | 'session.prompt'
    | 'session.command'
    | 'session.terminate'
    | 'session.cancel';
    payload: Record<string, unknown>;
}

export interface MissionWorkflowReducerResult {
    nextState: MissionWorkflowRuntimeState;
    signals: MissionWorkflowSignal[];
    requests: MissionWorkflowRequest[];
}

export interface MissionWorkflowReducer {
    reduce(
        current: MissionWorkflowRuntimeState,
        event: MissionWorkflowEvent,
        configuration: MissionWorkflowConfigurationSnapshot
    ): MissionWorkflowReducerResult;
}

export interface MissionRuntimeRecord {
    schemaVersion: number;
    missionId: string;
    configuration: MissionWorkflowConfigurationSnapshot;
    runtime: MissionWorkflowRuntimeState;
    eventLog?: MissionWorkflowEventRecord[];
}

export const MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION = 1;
