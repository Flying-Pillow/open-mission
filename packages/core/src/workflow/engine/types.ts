import { z } from 'zod/v4';
import { AgentExecutionJournalPathSchema, AgentExecutionTerminalHandleSchema, AgentExecutionTerminalRecordingPathSchema, type AgentExecutionTerminalHandleType } from '../../entities/AgentExecution/AgentExecutionSchema.js';
import { type AgentIdType } from '../../entities/Agent/AgentSchema.js';
import {
    AgentExecutionReasoningEffortSchema,
    type AgentExecutionReasoningEffortType
} from '../../entities/AgentExecution/AgentExecutionSchema.js';
import { TaskContextArtifactReferenceSchema, type TaskContextArtifactReferenceType } from '../../entities/Task/TaskSchema.js';
import {
    WorkflowDefinitionSchema,
} from '../WorkflowSchema.js';
import {
    MISSION_AGENT_EXECUTION_LIFECYCLE_STATES,
    MISSION_LIFECYCLE_STATES,
    MISSION_STAGE_DERIVED_STATES,
    MISSION_TASK_LIFECYCLE_STATES
} from './constants.js';

export {
    MISSION_AGENT_EXECUTION_LIFECYCLE_STATES,
    MISSION_LIFECYCLE_STATES,
    MISSION_STAGE_DERIVED_STATES,
    MISSION_TASK_LIFECYCLE_STATES
} from './constants.js';

export { DEFAULT_TASK_MAX_REWORK_ITERATIONS } from './constants.js';

export type MissionStageId = string;

export type WorkflowLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

export type WorkflowStageDerivedState = (typeof MISSION_STAGE_DERIVED_STATES)[number];

export type WorkflowTaskLifecycleState = (typeof MISSION_TASK_LIFECYCLE_STATES)[number];

export type WorkflowPauseReason =
    | 'human-requested'
    | 'checkpoint'
    | 'agent-failure'
    | 'system';

export type AgentExecutionLifecycleState = (typeof MISSION_AGENT_EXECUTION_LIFECYCLE_STATES)[number];

export type WorkflowGateIntent = 'implement' | 'verify' | 'audit' | 'deliver';
export type WorkflowGateState = 'blocked' | 'passed';

const nonEmptyStringSchema = z.string().trim().min(1);
const unknownRecordSchema = z.record(z.string(), z.unknown());

export const WorkflowTaskRuntimeSettingsSchema = z.object({
    autostart: z.boolean(),
    maxReworkIterations: z.number().int().min(0).optional()
}).strict();

export type WorkflowTaskRuntimeSettings = z.infer<typeof WorkflowTaskRuntimeSettingsSchema>;

export const WorkflowTaskArtifactReferenceSchema = z.object({
    path: nonEmptyStringSchema,
    title: nonEmptyStringSchema.optional()
}).strict();

export type WorkflowTaskArtifactReference = z.infer<typeof WorkflowTaskArtifactReferenceSchema>;

export const WorkflowTaskReworkRequestSchema = z.object({
    requestId: nonEmptyStringSchema,
    requestedAt: nonEmptyStringSchema,
    actor: z.enum(['human', 'system', 'workflow']),
    reasonCode: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    iteration: z.number().int().min(0),
    maxIterations: z.number().int().min(0),
    sourceTaskId: nonEmptyStringSchema.optional(),
    sourceAgentExecutionId: nonEmptyStringSchema.optional(),
    launchedAt: nonEmptyStringSchema.optional(),
    resolvedAt: nonEmptyStringSchema.optional(),
    artifactRefs: z.array(WorkflowTaskArtifactReferenceSchema)
}).strict();

export type WorkflowTaskReworkRequest = z.infer<typeof WorkflowTaskReworkRequestSchema>;

export const WorkflowTaskPendingLaunchContextSchema = z.object({
    source: z.literal('rework'),
    requestId: nonEmptyStringSchema,
    createdAt: nonEmptyStringSchema,
    actor: z.enum(['human', 'system', 'workflow']),
    reasonCode: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    sourceTaskId: nonEmptyStringSchema.optional(),
    artifactRefs: z.array(WorkflowTaskArtifactReferenceSchema)
}).strict();

export type WorkflowTaskPendingLaunchContext = z.infer<typeof WorkflowTaskPendingLaunchContextSchema>;

export const WorkflowTaskRuntimeStateSchema = z.object({
    taskId: nonEmptyStringSchema,
    stageId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    instruction: nonEmptyStringSchema,
    model: nonEmptyStringSchema.optional(),
    reasoningEffort: AgentExecutionReasoningEffortSchema.optional(),
    taskKind: z.enum(['implementation', 'verification']).optional(),
    pairedTaskId: nonEmptyStringSchema.optional(),
    dependsOn: z.array(nonEmptyStringSchema),
    context: z.array(TaskContextArtifactReferenceSchema).optional(),
    lifecycle: z.enum(MISSION_TASK_LIFECYCLE_STATES),
    waitingOnTaskIds: z.array(nonEmptyStringSchema),
    runtime: WorkflowTaskRuntimeSettingsSchema,
    agentAdapter: nonEmptyStringSchema.optional(),
    retries: z.number().int().min(0),
    reworkIterationCount: z.number().int().min(0).optional(),
    reworkRequest: WorkflowTaskReworkRequestSchema.optional(),
    pendingLaunchContext: WorkflowTaskPendingLaunchContextSchema.optional(),
    createdAt: nonEmptyStringSchema,
    startedAt: nonEmptyStringSchema.optional(),
    updatedAt: nonEmptyStringSchema,
    completedAt: nonEmptyStringSchema.optional(),
    failedAt: nonEmptyStringSchema.optional(),
    cancelledAt: nonEmptyStringSchema.optional()
}).strict();

export type WorkflowTaskRuntimeState = z.infer<typeof WorkflowTaskRuntimeStateSchema>;

export const WorkflowPauseStateSchema = z.object({
    paused: z.boolean(),
    reason: z.enum(['human-requested', 'checkpoint', 'agent-failure', 'system']).optional(),
    targetType: z.enum(['mission', 'task', 'AgentExecution']).optional(),
    id: nonEmptyStringSchema.optional(),
    requestedAt: nonEmptyStringSchema.optional()
}).strict();

export type WorkflowPauseState = z.infer<typeof WorkflowPauseStateSchema>;

export const WorkflowTaskLaunchRequestSchema = z.object({
    requestId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    requestedAt: nonEmptyStringSchema,
    requestedBy: z.enum(['system', 'human', 'daemon']),
    causedByEventId: nonEmptyStringSchema.optional(),
    agentId: nonEmptyStringSchema.optional(),
    prompt: z.string().optional(),
    workingDirectory: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    reasoningEffort: AgentExecutionReasoningEffortSchema.optional(),
    terminalName: nonEmptyStringSchema.optional(),
    dispatchedAt: nonEmptyStringSchema.optional()
}).strict();

export type WorkflowTaskLaunchRequest = z.infer<typeof WorkflowTaskLaunchRequestSchema>;

export const WorkflowStageRuntimeTimelineSchema = z.object({
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

export type WorkflowStageRuntimeTimeline = z.infer<typeof WorkflowStageRuntimeTimelineSchema>;

export const AgentExecutionRuntimeStateSchema = z.object({
    agentExecutionId: nonEmptyStringSchema,
    taskId: nonEmptyStringSchema,
    agentId: nonEmptyStringSchema,
    transportId: nonEmptyStringSchema.optional(),
    agentJournalPath: AgentExecutionJournalPathSchema.optional(),
    terminalRecordingPath: AgentExecutionTerminalRecordingPathSchema.optional(),
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

export const WorkflowGateTimelineSchema = z.object({
    gateId: nonEmptyStringSchema,
    intent: z.enum(['implement', 'verify', 'audit', 'deliver']),
    state: z.enum(['blocked', 'passed']),
    stageId: nonEmptyStringSchema.optional(),
    reasons: z.array(z.string()),
    updatedAt: nonEmptyStringSchema
}).strict();

export type WorkflowGateTimeline = z.infer<typeof WorkflowGateTimelineSchema>;

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

export const WorkflowConfigurationSnapshotSchema = z.object({
    createdAt: nonEmptyStringSchema,
    source: z.literal('workflow-definition'),
    workflowVersion: nonEmptyStringSchema,
    workflow: WorkflowDefinitionSchema
}).strict();

export type WorkflowConfigurationSnapshot = z.infer<typeof WorkflowConfigurationSnapshotSchema>;

export const WorkflowRuntimeStateSchema = z.object({
    lifecycle: z.enum(MISSION_LIFECYCLE_STATES),
    activeStageId: nonEmptyStringSchema.optional(),
    pause: WorkflowPauseStateSchema,
    stages: z.array(WorkflowStageRuntimeTimelineSchema),
    tasks: z.array(WorkflowTaskRuntimeStateSchema),
    agentExecutions: z.array(AgentExecutionRuntimeStateSchema),
    gates: z.array(WorkflowGateTimelineSchema),
    launchQueue: z.array(WorkflowTaskLaunchRequestSchema),
    updatedAt: nonEmptyStringSchema
}).strict();

export type WorkflowRuntimeState = z.infer<typeof WorkflowRuntimeStateSchema>;

export interface WorkflowEventBase {
    eventId: string;
    type: string;
    occurredAt: string;
    source: 'system' | 'human' | 'agent' | 'daemon' | 'copilot';
    causedByRequestId?: string;
}

export interface WorkflowGeneratedTaskPayload {
    taskId: string;
    title: string;
    instruction: string;
    model?: string;
    reasoningEffort?: AgentExecutionReasoningEffortType;
    taskKind?: 'implementation' | 'verification';
    pairedTaskId?: string;
    dependsOn: string[];
    context?: TaskContextArtifactReferenceType[];
    agentAdapter?: AgentIdType;
}

export interface WorkflowCreatedEvent extends WorkflowEventBase {
    type: 'mission.created';
}

export interface WorkflowStartedEvent extends WorkflowEventBase {
    type: 'mission.started';
}

export interface WorkflowResumedEvent extends WorkflowEventBase {
    type: 'mission.resumed';
}

export interface WorkflowPausedEvent extends WorkflowEventBase {
    type: 'mission.paused';
    reason: WorkflowPauseReason;
    targetType?: 'mission' | 'task' | 'AgentExecution';
    id?: string;
}

export interface WorkflowLaunchQueueRestartedEvent extends WorkflowEventBase {
    type: 'mission.launch-queue.restarted';
}

export interface WorkflowDeliveredEvent extends WorkflowEventBase {
    type: 'mission.delivered';
}

export interface TasksGeneratedEvent extends WorkflowEventBase {
    type: 'tasks.generated';
    stageId: MissionStageId;
    tasks: WorkflowGeneratedTaskPayload[];
}

export interface TaskLaunchPolicyChangedEvent extends WorkflowEventBase {
    type: 'task.launch-policy.changed';
    taskId: string;
    autostart: boolean;
}

export interface TaskConfiguredEvent extends WorkflowEventBase {
    type: 'task.configured';
    taskId: string;
    agentAdapter?: string;
    model?: string | null;
    reasoningEffort?: AgentExecutionReasoningEffortType | null;
    autostart?: boolean;
    context?: TaskContextArtifactReferenceType[];
}

export interface TaskQueuedEvent extends WorkflowEventBase {
    type: 'task.queued';
    taskId: string;
    agentId?: string;
    prompt?: string;
    workingDirectory?: string;
    model?: string;
    reasoningEffort?: AgentExecutionReasoningEffortType;
    terminalName?: string;
}

export interface TaskStartedEvent extends WorkflowEventBase {
    type: 'task.started';
    taskId: string;
}

export interface TaskMarkedDoneEvent extends WorkflowEventBase {
    type: 'task.completed';
    taskId: string;
}

export interface TaskCancelledEvent extends WorkflowEventBase {
    type: 'task.cancelled';
    taskId: string;
    reason?: string;
}

export interface TaskReopenedEvent extends WorkflowEventBase {
    type: 'task.reopened';
    taskId: string;
}

export interface TaskReworkedEvent extends WorkflowEventBase {
    type: 'task.reworked';
    taskId: string;
    actor: 'human' | 'system' | 'workflow';
    reasonCode: string;
    summary: string;
    sourceTaskId?: string;
    sourceAgentExecutionId?: string;
    artifactRefs: WorkflowTaskArtifactReference[];
}

export interface AgentExecutionStartedEvent extends WorkflowEventBase {
    type: 'execution.started';
    agentExecutionId: string;
    taskId: string;
    agentId: string;
    transportId?: string;
    agentJournalPath?: string;
    terminalRecordingPath?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
}

export interface AgentExecutionLaunchFailedEvent extends WorkflowEventBase {
    type: 'execution.launch-failed';
    taskId: string;
    reason?: string;
}

export interface AgentExecutionCompletedEvent extends WorkflowEventBase {
    type: 'execution.completed';
    agentExecutionId: string;
    taskId: string;
}

export interface AgentExecutionFailedEvent extends WorkflowEventBase {
    type: 'execution.failed';
    agentExecutionId: string;
    taskId: string;
}

export interface AgentExecutionCancelledEvent extends WorkflowEventBase {
    type: 'execution.cancelled';
    agentExecutionId: string;
    taskId: string;
}

export interface AgentExecutionTerminatedEvent extends WorkflowEventBase {
    type: 'execution.terminated';
    agentExecutionId: string;
    taskId: string;
}

export type WorkflowEvent =
    | WorkflowCreatedEvent
    | WorkflowStartedEvent
    | WorkflowResumedEvent
    | WorkflowPausedEvent
    | WorkflowLaunchQueueRestartedEvent
    | WorkflowDeliveredEvent
    | TasksGeneratedEvent
    | TaskLaunchPolicyChangedEvent
    | TaskConfiguredEvent
    | TaskQueuedEvent
    | TaskStartedEvent
    | TaskMarkedDoneEvent
    | TaskCancelledEvent
    | TaskReopenedEvent
    | TaskReworkedEvent
    | AgentExecutionStartedEvent
    | AgentExecutionLaunchFailedEvent
    | AgentExecutionCompletedEvent
    | AgentExecutionFailedEvent
    | AgentExecutionCancelledEvent
    | AgentExecutionTerminatedEvent;

export const WorkflowEventRecordSchema = z.object({
    eventId: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    occurredAt: nonEmptyStringSchema,
    source: z.enum(['system', 'human', 'agent', 'daemon', 'copilot']),
    causedByRequestId: nonEmptyStringSchema.optional(),
    payload: unknownRecordSchema
}).strict();

export type WorkflowEventRecord = z.infer<typeof WorkflowEventRecordSchema>;

export interface WorkflowSignal {
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

export interface WorkflowRequest {
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

export interface WorkflowReducerResult {
    nextState: WorkflowRuntimeState;
    signals: WorkflowSignal[];
    requests: WorkflowRequest[];
}

export interface WorkflowReducer {
    reduce(
        current: WorkflowRuntimeState,
        event: WorkflowEvent,
        configuration: WorkflowConfigurationSnapshot
    ): WorkflowReducerResult;
}

export const WORKFLOW_RUNTIME_SCHEMA_VERSION = 1;

export const WorkflowStateDataSchema = z.object({
    schemaVersion: z.literal(WORKFLOW_RUNTIME_SCHEMA_VERSION),
    missionId: nonEmptyStringSchema,
    configuration: WorkflowConfigurationSnapshotSchema,
    runtime: WorkflowRuntimeStateSchema
}).strict();

export type WorkflowStateData = z.infer<typeof WorkflowStateDataSchema>;
