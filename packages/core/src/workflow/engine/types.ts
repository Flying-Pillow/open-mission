import { z } from 'zod/v4';
import { AgentExecutionTerminalHandleSchema, type AgentExecutionTerminalHandleType } from '../../entities/AgentExecution/AgentExecutionSchema.js';
import { type AgentIdType } from '../../entities/Agent/AgentSchema.js';
import { MissionReasoningEffortSchema, type MissionReasoningEffortType } from '../../entities/Mission/MissionSchema.js';
import { TaskContextArtifactReferenceSchema, type TaskContextArtifactReferenceType } from '../../entities/Task/TaskSchema.js';
import {
    WorkflowDefinitionSchema,
} from '../WorkflowSchema.js';

export type MissionStageId = string;

export const MISSION_LIFECYCLE_STATES = [
    'draft',
    'ready',
    'running',
    'paused',
    'completed',
    'delivered'
] as const;

export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

export const MISSION_STAGE_DERIVED_STATES = [
    'pending',
    'ready',
    'running',
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
    | 'checkpoint'
    | 'agent-failure'
    | 'system';

export const MISSION_AGENT_EXECUTION_LIFECYCLE_STATES = [
    'starting',
    'running',
    'completed',
    'failed',
    'cancelled',
    'terminated'
] as const;

export type AgentExecutionLifecycleState = (typeof MISSION_AGENT_EXECUTION_LIFECYCLE_STATES)[number];

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
    model: nonEmptyStringSchema.optional(),
    reasoningEffort: MissionReasoningEffortSchema.optional(),
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: nonEmptyStringSchema.optional(),
    dependsOn: z.array(nonEmptyStringSchema),
    context: z.array(TaskContextArtifactReferenceSchema).optional(),
    lifecycle: z.enum(MISSION_TASK_LIFECYCLE_STATES),
    waitingOnTaskIds: z.array(nonEmptyStringSchema),
    runtime: MissionTaskRuntimeSettingsSchema,
    agentAdapter: nonEmptyStringSchema.optional(),
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
    reason: z.enum(['human-requested', 'checkpoint', 'agent-failure', 'system']).optional(),
    targetType: z.enum(['mission', 'task', 'session']).optional(),
    targetId: nonEmptyStringSchema.optional(),
    requestedAt: nonEmptyStringSchema.optional()
}).strict();

export type MissionPauseState = z.infer<typeof MissionPauseStateSchema>;

export const MissionTaskLaunchRequestSchema = z.object({
    requestId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    requestedAt: nonEmptyStringSchema,
    requestedBy: z.enum(['system', 'human', 'daemon']),
    causedByEventId: nonEmptyStringSchema.optional(),
    agentId: nonEmptyStringSchema.optional(),
    prompt: z.string().optional(),
    workingDirectory: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    reasoningEffort: MissionReasoningEffortSchema.optional(),
    terminalName: nonEmptyStringSchema.optional(),
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

export const AgentExecutionRuntimeStateSchema = z.object({
    sessionId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    agentId: nonEmptyStringSchema,
    transportId: nonEmptyStringSchema.optional(),
    sessionLogPath: nonEmptyStringSchema.optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional(),
    lifecycle: z.enum(MISSION_AGENT_EXECUTION_LIFECYCLE_STATES),
    launchedAt: nonEmptyStringSchema,
    updatedAt: nonEmptyStringSchema,
    completedAt: nonEmptyStringSchema.optional(),
    failedAt: nonEmptyStringSchema.optional(),
    cancelledAt: nonEmptyStringSchema.optional(),
    terminatedAt: nonEmptyStringSchema.optional()
}).strict();

export type AgentExecutionRuntimeState = z.infer<typeof AgentExecutionRuntimeStateSchema>;

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
    WorkflowDefinition,
    WorkflowHumanInLoopSettings,
    WorkflowMissionAutostartSettings,
    WorkflowStageDefinition,
    WorkflowStageTaskLaunchPolicy,
    WorkflowTaskGenerationRule,
    WorkflowTaskTemplateSource
} from '../WorkflowSchema.js';

export const MissionWorkflowConfigurationSnapshotSchema = z.object({
    createdAt: nonEmptyStringSchema,
    source: z.literal('workflow-definition'),
    workflowVersion: nonEmptyStringSchema,
    workflow: WorkflowDefinitionSchema
}).strict();

export type MissionWorkflowConfigurationSnapshot = z.infer<typeof MissionWorkflowConfigurationSnapshotSchema>;

export const MissionWorkflowRuntimeStateSchema = z.object({
    lifecycle: z.enum(MISSION_LIFECYCLE_STATES),
    activeStageId: nonEmptyStringSchema.optional(),
    pause: MissionPauseStateSchema,
    stages: z.array(MissionStageRuntimeProjectionSchema),
    tasks: z.array(MissionTaskRuntimeStateSchema),
    sessions: z.array(AgentExecutionRuntimeStateSchema),
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
    model?: string;
    reasoningEffort?: MissionReasoningEffortType;
    taskKind?: 'implementation' | 'verification';
    pairedTaskId?: string;
    dependsOn: string[];
    context?: TaskContextArtifactReferenceType[];
    agentAdapter?: AgentIdType;
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

export interface TaskConfiguredEvent extends MissionWorkflowEventBase {
    type: 'task.configured';
    taskId: string;
    agentAdapter?: string;
    model?: string | null;
    reasoningEffort?: MissionReasoningEffortType | null;
    autostart?: boolean;
    context?: TaskContextArtifactReferenceType[];
}

export interface TaskQueuedEvent extends MissionWorkflowEventBase {
    type: 'task.queued';
    taskId: string;
    agentId?: string;
    prompt?: string;
    workingDirectory?: string;
    model?: string;
    reasoningEffort?: MissionReasoningEffortType;
    terminalName?: string;
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

export interface AgentExecutionStartedEvent extends MissionWorkflowEventBase {
    type: 'execution.started';
    sessionId: string;
    taskId: string;
    agentId: string;
    transportId?: string;
    sessionLogPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
}

export interface AgentExecutionLaunchFailedEvent extends MissionWorkflowEventBase {
    type: 'execution.launch-failed';
    taskId: string;
    reason?: string;
}

export interface AgentExecutionCompletedEvent extends MissionWorkflowEventBase {
    type: 'execution.completed';
    sessionId: string;
    taskId: string;
}

export interface AgentExecutionFailedEvent extends MissionWorkflowEventBase {
    type: 'execution.failed';
    sessionId: string;
    taskId: string;
}

export interface AgentExecutionCancelledEvent extends MissionWorkflowEventBase {
    type: 'execution.cancelled';
    sessionId: string;
    taskId: string;
}

export interface AgentExecutionTerminatedEvent extends MissionWorkflowEventBase {
    type: 'execution.terminated';
    sessionId: string;
    taskId: string;
}

export type MissionWorkflowEvent =
    | MissionCreatedEvent
    | MissionStartedEvent
    | MissionResumedEvent
    | MissionPausedEvent
    | MissionLaunchQueueRestartedEvent
    | MissionDeliveredEvent
    | TasksGeneratedEvent
    | TaskLaunchPolicyChangedEvent
    | TaskConfiguredEvent
    | TaskQueuedEvent
    | TaskStartedEvent
    | TaskMarkedDoneEvent
    | TaskReopenedEvent
    | TaskReworkedEvent
    | AgentExecutionStartedEvent
    | AgentExecutionLaunchFailedEvent
    | AgentExecutionCompletedEvent
    | AgentExecutionFailedEvent
    | AgentExecutionCancelledEvent
    | AgentExecutionTerminatedEvent;

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
    | 'execution.launch'
    | 'execution.prompt'
    | 'execution.command'
    | 'execution.terminate'
    | 'execution.cancel';
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
