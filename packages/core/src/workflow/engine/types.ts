import { z } from 'zod/v4';
import {
    WorkflowGlobalSettingsSchema,
} from '../WorkflowSchema.js';

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

export const DEFAULT_TASK_MAX_REWORK_ITERATIONS = 3;

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

export type AgentSessionLifecycleState = (typeof MISSION_AGENT_SESSION_LIFECYCLE_STATES)[number];

export type MissionGateIntent = 'implement' | 'verify' | 'audit' | 'deliver';
export type MissionGateState = 'blocked' | 'passed';

const nonEmptyStringSchema = z.string().trim().min(1);
const unknownRecordSchema = z.record(z.string(), z.unknown());

export const MissionTaskRuntimeSettingsSchema = z.object({
    autostart: z.boolean(),
    maxReworkIterations: z.number().int().min(0).optional()
}).strict();

export type MissionTaskRuntimeSettings = z.infer<typeof MissionTaskRuntimeSettingsSchema>;

export const MissionTaskArtifactReferenceSchema = z.object({
    path: nonEmptyStringSchema,
    title: nonEmptyStringSchema.optional()
}).strict();

export type MissionTaskArtifactReference = z.infer<typeof MissionTaskArtifactReferenceSchema>;

export const MissionTaskReworkRequestSchema = z.object({
    requestId: nonEmptyStringSchema,
    requestedAt: nonEmptyStringSchema,
    actor: z.enum(['human', 'system', 'workflow']),
    reasonCode: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    iteration: z.number().int().min(0),
    maxIterations: z.number().int().min(0),
    sourceTaskId: nonEmptyStringSchema.optional(),
    sourceSessionId: nonEmptyStringSchema.optional(),
    launchedAt: nonEmptyStringSchema.optional(),
    resolvedAt: nonEmptyStringSchema.optional(),
    artifactRefs: z.array(MissionTaskArtifactReferenceSchema)
}).strict();

export type MissionTaskReworkRequest = z.infer<typeof MissionTaskReworkRequestSchema>;

export const MissionTaskPendingLaunchContextSchema = z.object({
    source: z.literal('rework'),
    requestId: nonEmptyStringSchema,
    createdAt: nonEmptyStringSchema,
    actor: z.enum(['human', 'system', 'workflow']),
    reasonCode: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    sourceTaskId: nonEmptyStringSchema.optional(),
    artifactRefs: z.array(MissionTaskArtifactReferenceSchema)
}).strict();

export type MissionTaskPendingLaunchContext = z.infer<typeof MissionTaskPendingLaunchContextSchema>;

export const MissionTaskRuntimeStateSchema = z.object({
    taskId: nonEmptyStringSchema,
    stageId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    instruction: nonEmptyStringSchema,
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: nonEmptyStringSchema.optional(),
    dependsOn: z.array(nonEmptyStringSchema),
    lifecycle: z.enum(MISSION_TASK_LIFECYCLE_STATES),
    waitingOnTaskIds: z.array(nonEmptyStringSchema),
    runtime: MissionTaskRuntimeSettingsSchema,
    agentRunner: nonEmptyStringSchema.optional(),
    retries: z.number().int().min(0),
    reworkIterationCount: z.number().int().min(0).optional(),
    reworkRequest: MissionTaskReworkRequestSchema.optional(),
    pendingLaunchContext: MissionTaskPendingLaunchContextSchema.optional(),
    createdAt: nonEmptyStringSchema,
    startedAt: nonEmptyStringSchema.optional(),
    updatedAt: nonEmptyStringSchema,
    completedAt: nonEmptyStringSchema.optional(),
    failedAt: nonEmptyStringSchema.optional(),
    cancelledAt: nonEmptyStringSchema.optional()
}).strict();

export type MissionTaskRuntimeState = z.infer<typeof MissionTaskRuntimeStateSchema>;

export const MissionPauseStateSchema = z.object({
    paused: z.boolean(),
    reason: z.enum(['human-requested', 'panic', 'checkpoint', 'agent-failure', 'system']).optional(),
    targetType: z.enum(['mission', 'task', 'session']).optional(),
    targetId: nonEmptyStringSchema.optional(),
    requestedAt: nonEmptyStringSchema.optional()
}).strict();

export type MissionPauseState = z.infer<typeof MissionPauseStateSchema>;

export const MissionPanicStateSchema = z.object({
    active: z.boolean(),
    requestedAt: nonEmptyStringSchema.optional(),
    requestedBy: z.enum(['human', 'system']).optional(),
    terminateSessions: z.boolean(),
    clearLaunchQueue: z.boolean(),
    haltMission: z.boolean()
}).strict();

export type MissionPanicState = z.infer<typeof MissionPanicStateSchema>;

export const MissionTaskLaunchRequestSchema = z.object({
    requestId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    requestedAt: nonEmptyStringSchema,
    requestedBy: z.enum(['system', 'human', 'daemon']),
    causedByEventId: nonEmptyStringSchema.optional(),
    runnerId: nonEmptyStringSchema.optional(),
    prompt: z.string().optional(),
    workingDirectory: nonEmptyStringSchema.optional(),
    terminalSessionName: nonEmptyStringSchema.optional(),
    dispatchedAt: nonEmptyStringSchema.optional()
}).strict();

export type MissionTaskLaunchRequest = z.infer<typeof MissionTaskLaunchRequestSchema>;

export const MissionStageRuntimeProjectionSchema = z.object({
    stageId: nonEmptyStringSchema,
    lifecycle: z.enum(MISSION_STAGE_DERIVED_STATES),
    taskIds: z.array(nonEmptyStringSchema),
    readyTaskIds: z.array(nonEmptyStringSchema),
    queuedTaskIds: z.array(nonEmptyStringSchema),
    runningTaskIds: z.array(nonEmptyStringSchema),
    completedTaskIds: z.array(nonEmptyStringSchema),
    enteredAt: nonEmptyStringSchema.optional(),
    completedAt: nonEmptyStringSchema.optional()
}).strict();

export type MissionStageRuntimeProjection = z.infer<typeof MissionStageRuntimeProjectionSchema>;

export const AgentSessionRuntimeStateSchema = z.object({
    sessionId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    runnerId: nonEmptyStringSchema,
    transportId: nonEmptyStringSchema.optional(),
    sessionLogPath: nonEmptyStringSchema.optional(),
    terminalSessionName: nonEmptyStringSchema.optional(),
    terminalPaneId: nonEmptyStringSchema.optional(),
    lifecycle: z.enum(MISSION_AGENT_SESSION_LIFECYCLE_STATES),
    launchedAt: nonEmptyStringSchema,
    updatedAt: nonEmptyStringSchema,
    completedAt: nonEmptyStringSchema.optional(),
    failedAt: nonEmptyStringSchema.optional(),
    cancelledAt: nonEmptyStringSchema.optional(),
    terminatedAt: nonEmptyStringSchema.optional()
}).strict();

export type AgentSessionRuntimeState = z.infer<typeof AgentSessionRuntimeStateSchema>;

export const MissionGateProjectionSchema = z.object({
    gateId: nonEmptyStringSchema,
    intent: z.enum(['implement', 'verify', 'audit', 'deliver']),
    state: z.enum(['blocked', 'passed']),
    stageId: nonEmptyStringSchema.optional(),
    reasons: z.array(z.string()),
    updatedAt: nonEmptyStringSchema
}).strict();

export type MissionGateProjection = z.infer<typeof MissionGateProjectionSchema>;

export type {
    WorkflowExecutionSettings,
    WorkflowGateDefinition,
    WorkflowGeneratedTaskDefinition,
    WorkflowGlobalSettings,
    WorkflowHumanInLoopSettings,
    WorkflowMissionAutostartSettings,
    WorkflowPanicSettings,
    WorkflowStageDefinition,
    WorkflowStageTaskLaunchPolicy,
    WorkflowTaskGenerationRule,
    WorkflowTaskTemplateSource
} from '../WorkflowSchema.js';

export const MissionWorkflowConfigurationSnapshotSchema = z.object({
    createdAt: nonEmptyStringSchema,
    source: z.literal('global-settings'),
    workflowVersion: nonEmptyStringSchema,
    workflow: WorkflowGlobalSettingsSchema
}).strict();

export type MissionWorkflowConfigurationSnapshot = z.infer<typeof MissionWorkflowConfigurationSnapshotSchema>;

export const MissionWorkflowRuntimeStateSchema = z.object({
    lifecycle: z.enum(MISSION_LIFECYCLE_STATES),
    activeStageId: nonEmptyStringSchema.optional(),
    pause: MissionPauseStateSchema,
    panic: MissionPanicStateSchema,
    stages: z.array(MissionStageRuntimeProjectionSchema),
    tasks: z.array(MissionTaskRuntimeStateSchema),
    sessions: z.array(AgentSessionRuntimeStateSchema),
    gates: z.array(MissionGateProjectionSchema),
    launchQueue: z.array(MissionTaskLaunchRequestSchema),
    updatedAt: nonEmptyStringSchema
}).strict();

export type MissionWorkflowRuntimeState = z.infer<typeof MissionWorkflowRuntimeStateSchema>;

export interface MissionWorkflowEventBase {
    eventId: string;
    type: string;
    occurredAt: string;
    source: 'system' | 'human' | 'agent' | 'daemon' | 'copilot';
    causedByRequestId?: string;
}

export interface MissionGeneratedTaskPayload {
    taskId: string;
    title: string;
    instruction: string;
    taskKind?: 'implementation' | 'verification';
    pairedTaskId?: string;
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

export interface TaskReworkedEvent extends MissionWorkflowEventBase {
    type: 'task.reworked';
    taskId: string;
    actor: 'human' | 'system' | 'workflow';
    reasonCode: string;
    summary: string;
    sourceTaskId?: string;
    sourceSessionId?: string;
    artifactRefs: MissionTaskArtifactReference[];
}

export interface AgentSessionStartedEvent extends MissionWorkflowEventBase {
    type: 'session.started';
    sessionId: string;
    taskId: string;
    runnerId: string;
    transportId?: string;
    sessionLogPath?: string;
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
    | TaskReworkedEvent
    | AgentSessionStartedEvent
    | AgentSessionLaunchFailedEvent
    | AgentSessionCompletedEvent
    | AgentSessionFailedEvent
    | AgentSessionCancelledEvent
    | AgentSessionTerminatedEvent;

export const MissionWorkflowEventRecordSchema = z.object({
    eventId: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    occurredAt: nonEmptyStringSchema,
    source: z.enum(['system', 'human', 'agent', 'daemon', 'copilot']),
    causedByRequestId: nonEmptyStringSchema.optional(),
    payload: unknownRecordSchema
}).strict();

export type MissionWorkflowEventRecord = z.infer<typeof MissionWorkflowEventRecordSchema>;

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

export const MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION = 1;

export const MissionStateDataSchema = z.object({
    schemaVersion: z.literal(MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION),
    missionId: nonEmptyStringSchema,
    configuration: MissionWorkflowConfigurationSnapshotSchema,
    runtime: MissionWorkflowRuntimeStateSchema
}).strict();

export type MissionStateData = z.infer<typeof MissionStateDataSchema>;
