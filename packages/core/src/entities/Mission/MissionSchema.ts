import { z } from 'zod/v4';
import type { SystemState as RuntimeSystemState } from '../../system/SystemContract.js';
import type { Repository } from '../Repository/Repository.js';
import type { RepositorySettingsType } from '../Repository/RepositorySchema.js';
import type {
    MissionGateProjection,
    MissionLifecycleState,
    MissionPauseState,
    MissionStageDerivedState,
    MissionStageRuntimeProjection,
    MissionTaskLifecycleState,
    MissionTaskRuntimeState,
    MissionWorkflowConfigurationSnapshot
} from '../../workflow/engine/types.js';
import type { MissionArtifactKey, MissionStageId } from '../../workflow/mission/manifest.js';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema,
    EntityIdSchema,
    EntityEventEnvelopeSchema
} from '../Entity/EntitySchema.js';
import {
    AgentExecutionEventSubjectSchema,
    AgentExecutionTerminalSnapshotSchema,
    AgentExecutionTerminalHandleSchema,
    AgentExecutionDataSchema,
    AgentExecutionDataChangedSchema,
    AgentExecutionLifecycleStateSchema,
    type AgentExecutionRecord,
    type AgentExecutionState,
    type MissionAgentPermissionRequest,
    type MissionAgentTelemetrySnapshot
} from '../AgentExecution/AgentExecutionSchema.js';
import {
    ArtifactEventLocatorSchema,
    ArtifactDataSchema,
    ArtifactDataChangedSchema
} from '../Artifact/ArtifactSchema.js';
import {
    StageDataSchema,
    StageEventSubjectSchema,
    StageDataChangedSchema
} from '../Stage/StageSchema.js';
import {
    TaskDataSchema,
    TaskEventSubjectSchema,
    TaskDataChangedSchema,
    type TaskContextArtifactReferenceType
} from '../Task/TaskSchema.js';
export const missionEntityName = 'Mission' as const;

export const MissionCommandIds = {
    pause: 'mission.pause',
    resume: 'mission.resume',
    restartQueue: 'mission.restartQueue',
    deliver: 'mission.deliver'
} as const;

export const MissionCommandIdSchema = z.enum([
    MissionCommandIds.pause,
    MissionCommandIds.resume,
    MissionCommandIds.restartQueue,
    MissionCommandIds.deliver
]);

export const MissionEntityTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);
export const MissionDefaultAgentModeSchema = z.enum(['interactive', 'autonomous']);
export const MissionReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export type MissionReasoningEffortType = z.infer<typeof MissionReasoningEffortSchema>;

export const MissionCommandInvocationSchema = z.object({
    commandId: MissionCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const MissionLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const MissionTerminalInputSchema = z.object({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Mission terminal input requires data or a complete cols/rows resize payload.'
});

export const MissionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const MissionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('input'),
        data: z.string(),
        literal: z.boolean().optional()
    }).strict(),
    z.object({
        type: z.literal('resize'),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    }).strict()
]);

export const MissionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const MissionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: MissionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: MissionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: MissionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type MissionTerminalInputType = z.infer<typeof MissionTerminalInputSchema>;
export type MissionTerminalSnapshotType = z.infer<typeof MissionTerminalSnapshotSchema>;
export type MissionTerminalSocketClientMessageType = z.infer<typeof MissionTerminalSocketClientMessageSchema>;
export type MissionTerminalOutputType = z.infer<typeof MissionTerminalOutputSchema>;
export type MissionTerminalSocketServerMessageType = z.infer<typeof MissionTerminalSocketServerMessageSchema>;

export const MISSION_RUNTIME_FILE_NAME = 'mission.json';
export const MISSION_RUNTIME_EVENT_LOG_FILE_NAME = 'mission.events.jsonl';

export type MissionType = z.infer<typeof MissionEntityTypeSchema>;
export type MissionProductKey = MissionArtifactKey;
export type MissionTaskStatus = MissionTaskLifecycleState;
export type MissionTaskAgent = string;

export type GateIntent = 'implement' | 'commit' | 'verify' | 'audit' | 'deliver';

export type MissionBrief = {
    issueId?: number;
    title: string;
    body: string;
    type: MissionType;
    url?: string;
    labels?: string[];
    metadata?: Record<string, string>;
};

export type MissionSelector = {
    missionId?: string;
    issueId?: number;
    branchRef?: string;
};

export type MissionDescriptor = {
    missionId: string;
    brief: MissionBrief;
    missionDir: string;
    branchRef: string;
    createdAt: string;
    deliveredAt?: string;
};

export type MissionRecord = {
    id: string;
    brief: MissionBrief;
    missionDir: string;
    missionRootDir?: string;
    branchRef: string;
    createdAt: string;
    stage: MissionStageId;
    deliveredAt?: string;
    agentExecutions: AgentExecutionRecord[];
};

export type MissionGateResult = {
    allowed: boolean;
    intent: GateIntent;
    stage?: MissionStageId;
    errors: string[];
    warnings: string[];
};

export type MissionTaskState = {
    taskId: string;
    stage: MissionStageId;
    sequence: number;
    subject: string;
    instruction: string;
    body: string;
    model?: string;
    reasoningEffort?: MissionReasoningEffortType;
    taskKind?: 'implementation' | 'verification';
    pairedTaskId?: string;
    dependsOn: string[];
    context?: TaskContextArtifactReferenceType[];
    waitingOn: string[];
    status: MissionTaskStatus;
    agent: MissionTaskAgent;
    autostart?: boolean;
    retries: number;
    fileName: string;
    filePath: string;
    relativePath: string;
};

export type TaskData = MissionTaskState;
export type MissionTaskUpdate = Partial<Pick<MissionTaskState, 'status' | 'agent' | 'retries'>>;

export type MissionStageStatus = {
    stage: MissionStageId;
    folderName: string;
    status: MissionStageDerivedState;
    taskCount: number;
    completedTaskCount: number;
    activeTaskIds: string[];
    readyTaskIds: string[];
    tasks: MissionTaskState[];
};

export type MissionSelectionCandidate = {
    missionId: string;
    title: string;
    branchRef: string;
    createdAt: string;
    issueId?: number;
};

export type RepositoryCandidate = {
    repositoryId: string;
    repositoryRootPath: string;
    label: string;
    description: string;
    githubRepository?: string;
};

export type MissionPreparationStatus =
    | {
        kind: 'repository-bootstrap';
        state: 'pull-request-opened';
        branchRef: string;
        baseBranch: string;
        pullRequestUrl: string;
        controlDirectoryPath: string;
        settingsPath: string;
        worktreesPath: string;
        missionsPath: string;
    }
    | {
        kind: 'mission';
        state: 'branch-prepared';
        missionId: string;
        branchRef: string;
        baseBranch: string;
        worktreePath: string;
        missionRootDir: string;
        issueId?: number;
        issueUrl?: string;
    };

export type MissionOperationalMode = 'setup' | 'root' | 'mission';
export type SystemSnapshot = RuntimeSystemState;

export type RepositoryControlStatus = {
    repositoryRootPath: string;
    missionDirectory: string;
    settingsPath: string;
    worktreesPath: string;
    currentBranch?: string;
    settings: RepositorySettingsType;
    isGitRepository: boolean;
    initialized: boolean;
    settingsPresent: boolean;
    trackingProvider?: 'github';
    githubRepository?: string;
    issuesConfigured: boolean;
    availableMissionCount: number;
    problems: string[];
    warnings: string[];
};

export type StageData = MissionStageStatus;
export type MissionTowerStageRailItemState = MissionStageDerivedState;

export type MissionTowerStageRailItem = {
    id: string;
    label: string;
    state: MissionTowerStageRailItemState;
    subtitle?: string;
};

export type MissionTowerTreeNodeKind = 'mission-artifact' | 'stage' | 'stage-artifact' | 'task' | 'task-artifact' | 'session';

export type MissionTowerTreeNode = {
    id: string;
    label: string;
    kind: MissionTowerTreeNodeKind;
    depth: number;
    color: string;
    statusLabel?: string;
    collapsible: boolean;
    sourcePath?: string;
    stageId?: MissionStageId;
    taskId?: string;
    autostart?: boolean;
    sessionId?: string;
};

export type MissionSelectionTarget = {
    kind: MissionTowerTreeNodeKind;
    label?: string;
    sourcePath?: string;
    stageId?: MissionStageId;
    taskId?: string;
    sessionId?: string;
};

export type MissionResolvedSelection = {
    missionId?: string;
    stageId?: MissionStageId;
    taskId?: string;
    activeMissionArtifact?: string;
    activeMissionArtifactPath?: string;
    activeInstructionArtifact?: string;
    activeInstructionPath?: string;
    activeStageResultArtifact?: string;
    activeStageResultPath?: string;
    activeAgentExecutionId?: string;
};

export type MissionTowerProjection = {
    stageRail: MissionTowerStageRailItem[];
    treeNodes: MissionTowerTreeNode[];
};

export type OperatorStatus = {
    found: boolean;
    operationalMode?: MissionOperationalMode;
    control?: RepositoryControlStatus;
    system?: SystemSnapshot;
    missionId?: string;
    title?: string;
    issueId?: number;
    type?: MissionType;
    stage?: MissionStageId;
    branchRef?: string;
    missionDir?: string;
    missionRootDir?: string;
    productFiles?: Partial<Record<MissionArtifactKey, string>>;
    activeTasks?: MissionTaskState[];
    readyTasks?: MissionTaskState[];
    stages?: MissionStageStatus[];
    agentExecutions?: AgentExecutionRecord[];
    tower?: MissionTowerProjection;
    workflow?: {
        lifecycle: MissionLifecycleState;
        pause: MissionPauseState;
        currentStageId?: MissionStageId;
        configuration: MissionWorkflowConfigurationSnapshot;
        stages: MissionStageRuntimeProjection[];
        tasks: MissionTaskRuntimeState[];
        gates: MissionGateProjection[];
        updatedAt: string;
    };
    recommendedAction?: string;
    availableMissions?: MissionSelectionCandidate[];
    availableRepositories?: Repository[];
    preparation?: MissionPreparationStatus;
};

export type OperatorData = OperatorStatus;

export type MissionAgentConsoleState = {
    title?: string;
    lines: string[];
    promptOptions: string[] | null;
    awaitingInput: boolean;
    agentId?: string;
    adapterLabel?: string;
    sessionId?: string;
};

export type MissionAgentConsoleEvent =
    | {
        type: 'reset';
        state: MissionAgentConsoleState;
    }
    | {
        type: 'lines';
        lines: string[];
        state: MissionAgentConsoleState;
    }
    | {
        type: 'prompt';
        state: MissionAgentConsoleState;
    };

export type MissionAgentEvent =
    | {
        type: 'session-state-changed';
        state: AgentExecutionState;
    }
    | {
        type: 'prompt-accepted';
        prompt: string;
        state: AgentExecutionState;
    }
    | {
        type: 'prompt-rejected';
        prompt: string;
        reason: string;
        state: AgentExecutionState;
    }
    | {
        type: 'session-started';
        state: AgentExecutionState;
    }
    | {
        type: 'session-resumed';
        state: AgentExecutionState;
    }
    | {
        type: 'agent-message';
        channel: 'stdout' | 'stderr' | 'system';
        text: string;
        state: AgentExecutionState;
    }
    | {
        type: 'permission-requested';
        request: MissionAgentPermissionRequest;
        state: AgentExecutionState;
    }
    | {
        type: 'tool-started';
        toolName: string;
        summary?: string;
        state: AgentExecutionState;
    }
    | {
        type: 'tool-finished';
        toolName: string;
        summary?: string;
        state: AgentExecutionState;
    }
    | {
        type: 'telemetry-updated';
        telemetry: MissionAgentTelemetrySnapshot;
        state: AgentExecutionState;
    }
    | {
        type: 'context-updated';
        telemetry: MissionAgentTelemetrySnapshot;
        state: AgentExecutionState;
    }
    | {
        type: 'cost-updated';
        telemetry: MissionAgentTelemetrySnapshot;
        state: AgentExecutionState;
    }
    | {
        type: 'session-completed';
        exitCode: number;
        state: AgentExecutionState;
    }
    | {
        type: 'session-failed';
        errorMessage: string;
        exitCode?: number;
        state: AgentExecutionState;
    }
    | {
        type: 'session-cancelled';
        reason?: string;
        state: AgentExecutionState;
    };

export const MissionEventSubjectSchema = MissionLocatorSchema.extend({
    entity: z.literal(missionEntityName)
}).strict();

export const MissionFindSchema = z.object({
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const MissionCatalogEntrySchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    branchRef: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional()
}).strict();

export const MissionChildEventSubjectSchema = z.discriminatedUnion('entity', [
    MissionEventSubjectSchema,
    StageEventSubjectSchema,
    TaskEventSubjectSchema,
    ArtifactEventLocatorSchema,
    AgentExecutionEventSubjectSchema
]);

export const MissionDocumentSnapshotSchema = z.object({
    filePath: z.string().trim().min(1),
    content: z.string(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const MissionWorkflowSnapshotSchema = z.object({
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    stages: z.array(StageDataSchema).optional()
}).strict();

export const MissionStatusSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional(),
    type: MissionEntityTypeSchema.optional(),
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    missionDir: z.string().trim().min(1).optional(),
    missionRootDir: z.string().trim().min(1).optional(),
    artifacts: z.array(ArtifactDataSchema).optional(),
    workflow: MissionWorkflowSnapshotSchema.optional(),
    recommendedAction: z.string().trim().min(1).optional()
}).strict();

export const MissionStorageSchema = z.object({
    id: EntityIdSchema,
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    issueId: z.number().int().positive().optional(),
    type: MissionEntityTypeSchema,
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1),
    missionDir: z.string().trim().min(1),
    missionRootDir: z.string().trim().min(1),
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    artifacts: z.array(ArtifactDataSchema),
    stages: z.array(StageDataSchema),
    agentExecutions: z.array(AgentExecutionDataSchema),
    recommendedAction: z.string().trim().min(1).optional()
}).strict();

export const MissionDataSchema = z.object({
    ...MissionStorageSchema.shape
}).strict();

export const MissionCommandOwnerSchema = z.discriminatedUnion('entity', [
    z.object({
        entity: z.literal('Mission')
    }).strict(),
    z.object({
        entity: z.literal('Stage'),
        stageId: z.string().trim().min(1)
    }).strict(),
    z.object({
        entity: z.literal('Task'),
        taskId: z.string().trim().min(1)
    }).strict(),
    z.object({
        entity: z.literal('AgentExecution'),
        sessionId: z.string().trim().min(1)
    }).strict()
]);

export const MissionOwnedCommandDescriptorSchema = z.object({
    owner: MissionCommandOwnerSchema,
    command: EntityCommandDescriptorSchema
}).strict();

export const MissionCommandViewSnapshotSchema = z.object({
    commands: z.array(MissionOwnedCommandDescriptorSchema),
    revision: z.string().trim().min(1)
}).strict();

export type MissionWorktreeNodeData = {
    name: string;
    relativePath: string;
    absolutePath: string;
    kind: 'file' | 'directory';
    children?: MissionWorktreeNodeData[] | undefined;
};

export const MissionWorktreeNodeSchema: z.ZodType<MissionWorktreeNodeData> = z.object({
    name: z.string().trim().min(1),
    relativePath: z.string(),
    absolutePath: z.string().trim().min(1),
    kind: z.enum(['file', 'directory']),
    children: z.array(z.lazy(() => MissionWorktreeNodeSchema)).optional()
}).strict();

export const MissionWorktreeSnapshotSchema = z.object({
    rootPath: z.string().trim().min(1),
    fetchedAt: z.string().trim().min(1),
    tree: z.array(MissionWorktreeNodeSchema)
}).strict();

export const MissionSnapshotSchema = z.object({
    mission: MissionDataSchema,
    commandView: MissionCommandViewSnapshotSchema.optional(),
    status: MissionStatusSnapshotSchema.optional(),
    workflow: MissionWorkflowSnapshotSchema.optional(),
    stages: z.array(StageDataSchema),
    tasks: z.array(TaskDataSchema),
    artifacts: z.array(ArtifactDataSchema),
    agentExecutions: z.array(AgentExecutionDataSchema),
    control: z.record(z.string(), z.unknown()).optional(),
    worktree: MissionWorktreeSnapshotSchema.optional()
}).strict();

export const MissionControlViewSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    status: MissionStatusSnapshotSchema.optional(),
    workflow: MissionWorkflowSnapshotSchema.optional(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const MissionSnapshotChangedEventSchema = z.object({
    reference: MissionEventSubjectSchema,
    snapshot: MissionSnapshotSchema
}).strict();

export const MissionAgentExecutionLifecycleNotificationSchema = z.object({
    phase: z.enum(['spawned', 'active', 'terminated']),
    lifecycleState: AgentExecutionLifecycleStateSchema
}).strict();

const MissionRuntimeEventEnvelopeBaseSchema = EntityEventEnvelopeSchema.omit({
    type: true,
    payload: true
});

export const MissionRuntimeEventEnvelopeSchema = z.discriminatedUnion('type', [
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('mission.snapshot.changed'),
        payload: MissionSnapshotChangedEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('mission.status'),
        payload: MissionStatusSnapshotSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('mission.terminal'),
        payload: MissionTerminalSnapshotSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('stage.data.changed'),
        payload: StageDataChangedSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('task.data.changed'),
        payload: TaskDataChangedSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('artifact.data.changed'),
        payload: ArtifactDataChangedSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('agentExecution.data.changed'),
        payload: AgentExecutionDataChangedSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.terminal'),
        payload: AgentExecutionTerminalSnapshotSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.event'),
        payload: AgentExecutionDataSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.lifecycle'),
        payload: MissionAgentExecutionLifecycleNotificationSchema
    })
]);

export const MissionReadDocumentInputSchema = MissionLocatorSchema.extend({
    path: z.string().trim().min(1)
}).strict();

export const MissionSendTerminalInputSchema = MissionLocatorSchema.extend({
    ...MissionTerminalInputSchema.shape
}).strict();

export const MissionCommandInputSchema = MissionLocatorSchema.extend({
    ...MissionCommandInvocationSchema.shape
}).strict();

export const MissionWriteDocumentInputSchema = MissionLocatorSchema.extend({
    path: z.string().trim().min(1),
    content: z.string()
}).strict();

export const MissionCommandMethodSchema = z.enum(['command']);

export const MissionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: MissionCommandMethodSchema,
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional()
}).strict();

export const MissionDocumentWriteAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: z.literal('writeDocument'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    path: z.string().trim().min(1)
}).strict();

export type MissionLocatorType = z.infer<typeof MissionLocatorSchema>;
export type MissionDefaultAgentModeType = z.infer<typeof MissionDefaultAgentModeSchema>;
export type MissionEventSubjectType = z.infer<typeof MissionEventSubjectSchema>;
export type MissionChildEventSubjectType = z.infer<typeof MissionChildEventSubjectSchema>;
export type MissionFindType = z.infer<typeof MissionFindSchema>;
export type MissionCatalogEntryType = z.infer<typeof MissionCatalogEntrySchema>;
export type MissionReadDocumentInputType = z.infer<typeof MissionReadDocumentInputSchema>;
export type MissionSendTerminalInputType = z.infer<typeof MissionSendTerminalInputSchema>;
export type MissionCommandInputType = z.infer<typeof MissionCommandInputSchema>;
export type MissionWriteDocumentInputType = z.infer<typeof MissionWriteDocumentInputSchema>;
export type MissionSnapshotType = z.infer<typeof MissionSnapshotSchema>;
export type MissionControlViewSnapshotType = z.infer<typeof MissionControlViewSnapshotSchema>;
export type MissionRuntimeEventEnvelopeType = z.infer<typeof MissionRuntimeEventEnvelopeSchema>;
export type MissionCommandOwnerType = z.infer<typeof MissionCommandOwnerSchema>;
export type MissionOwnedCommandDescriptorType = z.infer<typeof MissionOwnedCommandDescriptorSchema>;
export type MissionCommandViewSnapshotType = z.infer<typeof MissionCommandViewSnapshotSchema>;
export type MissionCommandIdType = z.infer<typeof MissionCommandIdSchema>;
export type MissionStorageType = z.infer<typeof MissionStorageSchema>;
export type MissionDataType = z.infer<typeof MissionDataSchema>;
export type MissionStatusSnapshotType = z.infer<typeof MissionStatusSnapshotSchema>;
export type MissionWorkflowSnapshotType = z.infer<typeof MissionWorkflowSnapshotSchema>;
export type MissionCommandInvocationType = z.infer<typeof MissionCommandInvocationSchema>;
export type MissionDocumentSnapshotType = z.infer<typeof MissionDocumentSnapshotSchema>;
export type MissionWorktreeNodeType = z.infer<typeof MissionWorktreeNodeSchema>;
export type MissionWorktreeSnapshotType = z.infer<typeof MissionWorktreeSnapshotSchema>;
export type MissionCommandAcknowledgementType = z.infer<typeof MissionCommandAcknowledgementSchema>;
export type MissionDocumentWriteAcknowledgementType = z.infer<typeof MissionDocumentWriteAcknowledgementSchema>;
