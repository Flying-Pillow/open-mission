import { z } from 'zod/v4';
import { repositorySchema } from './Repository.js';
import { missionSessionTerminalHandleSchema } from './MissionRuntime.js';
import type {
    AgentCommand,
    AgentPrompt,
    AgentSession,
    Artifact,
    Mission,
    MissionRuntimeMissionCommandInput,
    MissionRuntimeSessionCommandInput,
    MissionRuntimeSnapshot,
    MissionRuntimeTaskCommandInput,
    MissionSessionTerminalHandle,
    Stage,
    Task
} from './MissionRuntime.js';
import type {
    AirportRuntimeEventEnvelope,
    AirportRuntimeEventType
} from './RuntimeEvents.js';
import type {
    GitHubIssueDetail,
    MissionReference,
    Repository,
    RepositorySnapshot,
    TrackedIssueSummary
} from './Repository.js';

export const githubVisibleRepositorySchema = z.object({
    fullName: z.string().trim().min(1),
    ownerLogin: z.string().trim().min(1).optional(),
    htmlUrl: z.string().trim().url().optional(),
    visibility: z.enum(['private', 'public']),
    archived: z.boolean()
}).strict();

export const airportHomeSnapshotSchema = z.object({
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    repositories: z.array(repositorySchema),
    selectedRepositoryRoot: z.string().trim().min(1).optional()
}).strict();

export const missionRuntimeRouteParamsSchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const missionSessionTerminalRouteParamsSchema = z.object({
    sessionId: z.string().trim().min(1)
}).strict();

export const missionSessionTerminalQuerySchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const missionSessionTerminalInputSchema = z.object({
    missionId: z.string().trim().min(1),
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Terminal input requests require data or a complete cols/rows resize payload.'
});

export const missionTerminalInputSchema = z.object({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Mission terminal input requests require data or a complete cols/rows resize payload.'
});

export const repositoryRuntimeRouteParamsSchema = z.object({
    repositoryId: z.string().trim().min(1)
}).strict();

export const airportRuntimeEventsQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional()
}).strict();

export const missionSessionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
}).strict();

export const missionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
}).strict();

export const missionSessionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const missionSessionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
}).strict();

export const missionSessionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: missionSessionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export const missionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const missionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
}).strict();

export const missionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: missionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type AirportHomeSnapshot = z.infer<typeof airportHomeSnapshotSchema>;
export type GitHubVisibleRepository = z.infer<typeof githubVisibleRepositorySchema>;
export type MissionRuntimeRouteParams = z.infer<typeof missionRuntimeRouteParamsSchema>;
export type MissionSessionTerminalInput = z.infer<typeof missionSessionTerminalInputSchema>;
export type MissionSessionTerminalOutput = z.infer<typeof missionSessionTerminalOutputSchema>;
export type MissionSessionTerminalQuery = z.infer<typeof missionSessionTerminalQuerySchema>;
export type MissionSessionTerminalRouteParams = z.infer<typeof missionSessionTerminalRouteParamsSchema>;
export type MissionSessionTerminalSnapshot = z.infer<typeof missionSessionTerminalSnapshotSchema>;
export type MissionSessionTerminalSocketClientMessage = z.infer<typeof missionSessionTerminalSocketClientMessageSchema>;
export type MissionSessionTerminalSocketServerMessage = z.infer<typeof missionSessionTerminalSocketServerMessageSchema>;
export type MissionTerminalInput = z.infer<typeof missionTerminalInputSchema>;
export type MissionTerminalOutput = z.infer<typeof missionTerminalOutputSchema>;
export type MissionTerminalSnapshot = z.infer<typeof missionTerminalSnapshotSchema>;
export type MissionTerminalSocketClientMessage = z.infer<typeof missionTerminalSocketClientMessageSchema>;
export type MissionTerminalSocketServerMessage = z.infer<typeof missionTerminalSocketServerMessageSchema>;
export type RepositoryRuntimeRouteParams = z.infer<typeof repositoryRuntimeRouteParamsSchema>;

export type {
    AgentCommand,
    AgentPrompt,
    AgentSession,
    AirportRuntimeEventEnvelope,
    AirportRuntimeEventType,
    Artifact,
    GitHubIssueDetail,
    Mission,
    MissionReference,
    MissionRuntimeMissionCommandInput,
    MissionRuntimeSessionCommandInput,
    MissionRuntimeSnapshot,
    MissionRuntimeTaskCommandInput,
    MissionSessionTerminalHandle,
    Repository,
    RepositorySnapshot,
    Stage,
    Task,
    TrackedIssueSummary
};

export type {
    AgentSessionContext,
    ArtifactContext,
    ContextGraph,
    MissionResolvedSelection,
    MissionSelectionTarget,
    MissionStageId,
    MissionTowerTreeNode,
    OperatorActionDescriptor,
    OperatorActionExecutionStep,
    OperatorActionFlowStep,
    OperatorActionListSnapshot,
    OperatorActionQueryContext,
    OperatorActionTargetContext,
    OperatorStatus
} from '../types.js';
