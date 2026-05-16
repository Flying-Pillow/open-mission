import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import { type AgentExecutionLaunchModeType } from '../AgentExecution/AgentExecutionSchema.js';
import {
    WorkflowGateTimelineSchema,
    WorkflowPauseStateSchema,
    WorkflowStageRuntimeTimelineSchema,
    WorkflowTaskRuntimeStateSchema,
    type WorkflowTaskLifecycleState
} from '../../workflow/engine/types.js';
import { type MissionArtifactKey } from '../../workflow/mission/manifest.js';
import {
    EntityCommandAcknowledgementSchema,
    EntitySchema,
    EntityStorageSchema,
    EntityEventEnvelopeSchema
} from '../Entity/EntitySchema.js';
import {
    AgentExecutionEventSubjectSchema,
    AgentExecutionTerminalSchema,
    AgentExecutionSchema,
    AgentExecutionChangedSchema,
    AgentExecutionLifecycleStateSchema
} from '../AgentExecution/AgentExecutionSchema.js';
import {
    ArtifactEventLocatorSchema,
    ArtifactDataSchema,
    ArtifactDataChangedSchema
} from '../Artifact/ArtifactSchema.js';
import {
    StageSchema,
    StageEventSubjectSchema,
    StageDataChangedSchema
} from '../Stage/StageSchema.js';
import {
    TaskSchema,
    TaskEventSubjectSchema,
    TaskDataChangedSchema
} from '../Task/TaskSchema.js';
import { MissionTerminalSnapshotSchema } from '../Terminal/MissionTerminalSchema.js';
export const missionEntityName = 'Mission' as const;

export const MissionTypeSchema = z.enum([
    'task',
    'feature',
    'fix',
    'docs',
    'refactor'
]);

export const MissionAssigneeSourceSchema = z.enum([
    'manual',
    'issue-assignee',
    'repository-default'
]);

export const MissionAssigneeSchema = z.object({
    githubLogin: z.string().trim().min(1),
    githubUserId: z.number().int().positive().optional(),
    source: MissionAssigneeSourceSchema
}).strict();

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

export const MissionLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const MISSION_RUNTIME_FILE_NAME = 'mission.json';
export const MISSION_RUNTIME_EVENT_LOG_FILE_NAME = 'mission.events.jsonl';

export type MissionProductKey = MissionArtifactKey;
export type MissionTaskStatus = WorkflowTaskLifecycleState;

export type GateIntent = 'implement' | 'commit' | 'verify' | 'audit' | 'deliver';

export type MissionBrief = {
    issueId?: number;
    title: string;
    body: string;
    type: MissionEntityTypeType;
    url?: string;
    labels?: string[];
    assignee?: MissionAssignee;
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

type MissionWorktreeNodeData = {
    name: string;
    relativePath: string;
    absolutePath: string;
    kind: 'file' | 'directory';
    children?: MissionWorktreeNodeData[] | undefined;
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

export const MissionInstanceInputSchema = z.object({}).strict();

export const MissionSelectionCandidateSchema = MissionCatalogEntrySchema.extend({
    assignee: MissionAssigneeSchema.optional()
}).strict();

export const MissionPreparationStatusSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('repository-bootstrap'),
        state: z.literal('pull-request-opened'),
        branchRef: z.string().trim().min(1),
        baseBranch: z.string().trim().min(1),
        pullRequestUrl: z.string().trim().min(1),
        controlDirectoryPath: z.string().trim().min(1),
        settingsPath: z.string().trim().min(1),
        worktreesPath: z.string().trim().min(1),
        missionsPath: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('mission'),
        state: z.literal('branch-prepared'),
        missionId: z.string().trim().min(1),
        branchRef: z.string().trim().min(1),
        baseBranch: z.string().trim().min(1),
        worktreePath: z.string().trim().min(1),
        missionRootDir: z.string().trim().min(1),
        issueId: z.number().int().positive().optional(),
        issueUrl: z.string().trim().min(1).optional()
    }).strict()
]);

export const MissionChildEventSubjectSchema = z.discriminatedUnion('entity', [
    MissionEventSubjectSchema,
    StageEventSubjectSchema,
    TaskEventSubjectSchema,
    ArtifactEventLocatorSchema,
    AgentExecutionEventSubjectSchema
]);

export const MissionDocumentSchema = z.object({
    filePath: z.string().trim().min(1),
    content: z.string(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const MissionStorageSchema = EntityStorageSchema.extend({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).register(field, {
        searchable: true,
        description: 'Mission title stored in the physical Mission record.'
    }),
    issueId: z.number().int().positive().optional().register(field, {
        optional: true,
        index: 'normal',
        description: 'Optional hosted issue number associated with the Mission.'
    }),
    assignee: MissionAssigneeSchema.optional().register(field, {
        optional: true,
        description: 'Optional Mission assignee stored in the physical Mission record.'
    }),
    type: MissionTypeSchema.register(field, {
        index: 'normal',
        description: 'Mission type stored in the physical Mission record.'
    }),
    operationalMode: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional Mission operational mode stored in the physical Mission record.'
    }),
    branchRef: z.string().trim().min(1).register(field, {
        index: 'unique',
        description: 'Mission branch ref stored in the physical Mission record.'
    }),
    missionDir: z.string().trim().min(1).register(field, {
        description: 'Tracked Mission directory path stored in the physical Mission record.'
    }),
    missionRootDir: z.string().trim().min(1).register(field, {
        description: 'Mission worktree root directory stored in the physical Mission record.'
    }),
    lifecycle: z.string().trim().min(1).optional().register(field, {
        optional: true,
        index: 'normal',
        description: 'Optional Mission lifecycle state stored in the physical Mission record.'
    }),
    updatedAt: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional last-update timestamp stored in the physical Mission record.'
    }),
    currentStageId: z.string().trim().min(1).optional().register(field, {
        reference: 'Stage',
        optional: true,
        index: 'normal',
        description: 'Optional current Stage reference stored in the physical Mission record.'
    }),
    recommendedAction: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional recommended operator action stored in the physical Mission record.'
    })
}).strict().register(table, {
    table: 'mission',
    schemafull: true,
    description: 'Mission physical storage record. SurrealDB record id is the Mission identity.'
});

export const MissionWorkflowStateSchema = MissionStorageSchema.pick({
    lifecycle: true,
    updatedAt: true,
    currentStageId: true
}).extend({
    pause: WorkflowPauseStateSchema.optional(),
    stages: z.array(WorkflowStageRuntimeTimelineSchema).optional(),
    tasks: z.array(WorkflowTaskRuntimeStateSchema).optional(),
    gates: z.array(WorkflowGateTimelineSchema).optional()
}).strict();

export const MissionWorktreeNodeSchema: z.ZodType<MissionWorktreeNodeData> = z.lazy(() => z.object({
    name: z.string().trim().min(1),
    relativePath: z.string(),
    absolutePath: z.string().trim().min(1),
    kind: z.enum(['file', 'directory']),
    children: z.array(MissionWorktreeNodeSchema).optional()
}).strict());

export const MissionWorktreeSchema = z.object({
    rootPath: z.string().trim().min(1),
    fetchedAt: z.string().trim().min(1),
    tree: z.array(MissionWorktreeNodeSchema)
}).strict();

export const MissionSchema = EntitySchema.extend({
    ...MissionStorageSchema.shape,
    artifacts: z.array(ArtifactDataSchema),
    stages: z.array(StageSchema),
    tasks: z.array(TaskSchema),
    agentExecutions: z.array(AgentExecutionSchema),
    workflow: MissionWorkflowStateSchema.optional(),
}).strict();

export const MissionControlSchema = z.object({
    missionId: z.string().trim().min(1),
    mission: MissionSchema,
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const MissionChangedEventSchema = z.object({
    reference: MissionEventSubjectSchema,
    mission: MissionSchema
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
        type: z.literal('mission.changed'),
        payload: MissionChangedEventSchema
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
        payload: AgentExecutionChangedSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.terminal'),
        payload: AgentExecutionTerminalSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.event'),
        payload: AgentExecutionSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('execution.lifecycle'),
        payload: MissionAgentExecutionLifecycleNotificationSchema
    })
]);

export const MissionReadDocumentInputSchema = z.object({
    path: z.string().trim().min(1)
}).strict();

export const MissionWriteDocumentInputSchema = z.object({
    path: z.string().trim().min(1),
    content: z.string()
}).strict();

export const MissionCommandMethodSchema = z.enum(['pause', 'resume', 'restartQueue', 'deliver']);

export const MissionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: MissionCommandMethodSchema,
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    taskId: z.string().trim().min(1).optional(),
    agentExecutionId: z.string().trim().min(1).optional()
}).strict();

export const MissionDocumentWriteAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionEntityName),
    method: z.literal('writeDocument'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    path: z.string().trim().min(1)
}).strict();

export type MissionLocatorType = z.infer<typeof MissionLocatorSchema>;
export type MissionEventSubjectType = z.infer<typeof MissionEventSubjectSchema>;
export type MissionChildEventSubjectType = z.infer<typeof MissionChildEventSubjectSchema>;
export type MissionFindType = z.infer<typeof MissionFindSchema>;
export type MissionCatalogEntryType = z.infer<typeof MissionCatalogEntrySchema>;
export type MissionSelectionCandidateType = z.infer<typeof MissionSelectionCandidateSchema>;
export type MissionPreparationStatusType = z.infer<typeof MissionPreparationStatusSchema>;
export type MissionAssignee = z.infer<typeof MissionAssigneeSchema>;
export type MissionInstanceInputType = z.infer<typeof MissionInstanceInputSchema>;
export type MissionReadDocumentInputType = z.infer<typeof MissionReadDocumentInputSchema>;
export type MissionWriteDocumentInputType = z.infer<typeof MissionWriteDocumentInputSchema>;
export type MissionType = z.infer<typeof MissionSchema>;
export type MissionControlType = z.infer<typeof MissionControlSchema>;
export type MissionRuntimeEventEnvelopeType = z.infer<typeof MissionRuntimeEventEnvelopeSchema>;
export type MissionCommandIdType = z.infer<typeof MissionCommandIdSchema>;
export type MissionStorageType = z.infer<typeof MissionStorageSchema>;
export type MissionWorkflowStateType = z.infer<typeof MissionWorkflowStateSchema>;
export type MissionEntityTypeType = z.infer<typeof MissionTypeSchema>;
export type MissionDefaultAgentModeType = AgentExecutionLaunchModeType;
export type MissionDocumentType = z.infer<typeof MissionDocumentSchema>;
export type MissionWorktreeNodeType = z.infer<typeof MissionWorktreeNodeSchema>;
export type MissionWorktreeType = z.infer<typeof MissionWorktreeSchema>;
export type MissionCommandAcknowledgementType = z.infer<typeof MissionCommandAcknowledgementSchema>;
export type MissionDocumentWriteAcknowledgementType = z.infer<typeof MissionDocumentWriteAcknowledgementSchema>;
