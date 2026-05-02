import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema,
    EntityEventEnvelopeSchema
} from '../Entity/EntitySchema.js';
import {
    AgentSessionEventSubjectSchema,
    AgentSessionTerminalHandleSchema,
    AgentSessionDataSchema,
    AgentSessionSnapshotChangedEventSchema,
    AgentSessionEventSchema,
    AgentSessionLifecycleEventSchema
} from '../AgentSession/AgentSessionSchema.js';
import {
    ArtifactEventSubjectSchema,
    ArtifactDataSchema,
    ArtifactSnapshotChangedEventSchema
} from '../Artifact/ArtifactSchema.js';
import {
    StageDataSchema,
    StageEventSubjectSchema,
    StageSnapshotChangedEventSchema
} from '../Stage/StageSchema.js';
import {
    TaskDataSchema,
    TaskEventSubjectSchema,
    TaskSnapshotChangedEventSchema
} from '../Task/TaskSchema.js';
export const missionEntityName = 'Mission' as const;

export const MissionEntityTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);

export const MissionCommandInvocationSchema = z.object({
    commandId: z.string().trim().min(1),
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
    terminalHandle: AgentSessionTerminalHandleSchema.optional()
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
    terminalHandle: AgentSessionTerminalHandleSchema.optional()
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
    issueId: z.number().int().positive().optional()
}).strict();

export const MissionChildEventSubjectSchema = z.discriminatedUnion('entity', [
    MissionEventSubjectSchema,
    StageEventSubjectSchema,
    TaskEventSubjectSchema,
    ArtifactEventSubjectSchema,
    AgentSessionEventSubjectSchema
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
    agentSessions: z.array(AgentSessionDataSchema),
    recommendedAction: z.string().trim().min(1).optional()
}).strict();

export const MissionDataSchema = z.object({
    ...MissionStorageSchema.shape,
    commands: z.array(EntityCommandDescriptorSchema).optional()
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
    status: MissionStatusSnapshotSchema.optional(),
    workflow: MissionWorkflowSnapshotSchema.optional(),
    stages: z.array(StageDataSchema),
    tasks: z.array(TaskDataSchema),
    artifacts: z.array(ArtifactDataSchema),
    agentSessions: z.array(AgentSessionDataSchema),
    control: z.record(z.string(), z.unknown()).optional(),
    worktree: MissionWorktreeSnapshotSchema.optional()
}).strict();

export const MissionProjectionSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    status: MissionStatusSnapshotSchema.optional(),
    workflow: MissionWorkflowSnapshotSchema.optional(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const MissionSnapshotChangedEventSchema = z.object({
    reference: MissionEventSubjectSchema,
    snapshot: MissionSnapshotSchema
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
        type: z.literal('stage.snapshot.changed'),
        payload: StageSnapshotChangedEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('task.snapshot.changed'),
        payload: TaskSnapshotChangedEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('artifact.snapshot.changed'),
        payload: ArtifactSnapshotChangedEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('agentSession.snapshot.changed'),
        payload: AgentSessionSnapshotChangedEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('session.event'),
        payload: AgentSessionEventSchema
    }),
    MissionRuntimeEventEnvelopeBaseSchema.extend({
        type: z.literal('session.lifecycle'),
        payload: AgentSessionLifecycleEventSchema
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

export const missionRemoteQueryInputSchemas = {
    find: MissionFindSchema,
    read: MissionLocatorSchema,
    readProjection: MissionLocatorSchema,
    readDocument: MissionReadDocumentInputSchema,
    readWorktree: MissionLocatorSchema,
    readTerminal: MissionLocatorSchema
} as const;

export const missionRemoteCommandInputSchemas = {
    command: MissionCommandInputSchema,
    writeDocument: MissionWriteDocumentInputSchema,
    ensureTerminal: MissionLocatorSchema,
    sendTerminalInput: MissionSendTerminalInputSchema
} as const;

export const missionRemoteQueryResultSchemas = {
    find: z.array(MissionCatalogEntrySchema),
    read: MissionSnapshotSchema,
    readProjection: MissionProjectionSnapshotSchema,
    readDocument: MissionDocumentSnapshotSchema,
    readWorktree: MissionWorktreeSnapshotSchema,
    readTerminal: MissionTerminalSnapshotSchema
} as const;

export const missionRemoteCommandResultSchemas = {
    command: MissionCommandAcknowledgementSchema,
    writeDocument: z.union([
        MissionDocumentWriteAcknowledgementSchema,
        MissionDocumentSnapshotSchema
    ]),
    ensureTerminal: MissionTerminalSnapshotSchema,
    sendTerminalInput: MissionTerminalSnapshotSchema
} as const;

export type MissionLocatorType = z.infer<typeof MissionLocatorSchema>;
export type MissionEventSubjectType = z.infer<typeof MissionEventSubjectSchema>;
export type MissionChildEventSubjectType = z.infer<typeof MissionChildEventSubjectSchema>;
export type MissionFindType = z.infer<typeof MissionFindSchema>;
export type MissionCatalogEntryType = z.infer<typeof MissionCatalogEntrySchema>;
export type MissionReadDocumentInputType = z.infer<typeof MissionReadDocumentInputSchema>;
export type MissionSendTerminalInputType = z.infer<typeof MissionSendTerminalInputSchema>;
export type MissionCommandInputType = z.infer<typeof MissionCommandInputSchema>;
export type MissionWriteDocumentInputType = z.infer<typeof MissionWriteDocumentInputSchema>;
export type MissionSnapshotType = z.infer<typeof MissionSnapshotSchema>;
export type MissionProjectionSnapshotType = z.infer<typeof MissionProjectionSnapshotSchema>;
export type MissionRuntimeEventEnvelopeType = z.infer<typeof MissionRuntimeEventEnvelopeSchema>;
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

