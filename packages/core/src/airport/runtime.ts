// /packages/core/src/airport/runtime.ts: Shared runtime API contracts and validators for Airport web surfaces.
import { z } from 'zod/v4';
import {
    githubIssueDetailSchema,
    missionReferenceSchema,
    repositorySchema,
    repositorySnapshotSchema,
    trackedIssueSummarySchema
} from '../schemas/Repository.js';
import {
    agentCommandSchema,
    agentPromptSchema,
    agentSessionSchema,
    artifactSchema,
    missionRuntimeMissionCommandSchema,
    missionRuntimeSessionCommandSchema,
    missionRuntimeSnapshotSchema,
    missionRuntimeTaskCommandSchema,
    missionSchema,
    missionSessionTerminalHandleSchema,
    stageSchema,
    taskSchema
} from '../schemas/MissionRuntime.js';
import {
    airportRuntimeEventEnvelopeSchema,
    airportRuntimeEventTypeSchema
} from '../schemas/RuntimeEvents.js';

export const missionRuntimeRouteParamsSchema = z.object({
    missionId: z.string().trim().min(1)
});

export const missionSessionTerminalRouteParamsSchema = z.object({
    sessionId: z.string().trim().min(1)
});

export const missionSessionTerminalQuerySchema = z.object({
    missionId: z.string().trim().min(1)
});

export const missionSessionTerminalInputSchema = z.object({
    missionId: z.string().trim().min(1),
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).refine((value) => {
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
}).refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Mission terminal input requests require data or a complete cols/rows resize payload.'
});

export const repositoryRuntimeRouteParamsSchema = z.object({
    repositoryId: z.string().trim().min(1)
});

export const githubVisibleRepositorySchema = z.object({
    fullName: z.string().trim().min(1),
    ownerLogin: z.string().trim().min(1).optional(),
    htmlUrl: z.string().trim().url().optional(),
    visibility: z.enum(['private', 'public']),
    archived: z.boolean()
});

export const airportRuntimeEventsQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional()
});

export const repositoryRouteQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional(),
    issueNumber: z.coerce.number().int().positive().optional()
});

export const airportHomeSnapshotSchema = z.object({
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    repositories: z.array(repositorySchema),
    selectedRepositoryRoot: z.string().trim().min(1).optional()
});

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
});

export const missionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
});

export const missionSessionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('input'),
        data: z.string(),
        literal: z.boolean().optional()
    }),
    z.object({
        type: z.literal('resize'),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    })
]);

export const missionSessionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
});

export const missionSessionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionSessionTerminalSnapshotSchema
    }),
    z.object({
        type: z.literal('output'),
        output: missionSessionTerminalOutputSchema
    }),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionSessionTerminalSnapshotSchema
    }),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    })
]);

export const missionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('input'),
        data: z.string(),
        literal: z.boolean().optional()
    }),
    z.object({
        type: z.literal('resize'),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    })
]);

export const missionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional()
});

export const missionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionTerminalSnapshotSchema
    }),
    z.object({
        type: z.literal('output'),
        output: missionTerminalOutputSchema
    }),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionTerminalSnapshotSchema
    }),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    })
]);

export type AirportRuntimeEventEnvelope = z.infer<typeof airportRuntimeEventEnvelopeSchema>;
export type AirportRuntimeEventType = z.infer<typeof airportRuntimeEventTypeSchema>;
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentPrompt = z.infer<typeof agentPromptSchema>;
export type AirportHomeSnapshot = z.infer<typeof airportHomeSnapshotSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type MissionSessionTerminalHandle = z.infer<typeof missionSessionTerminalHandleSchema>;
export type MissionSessionTerminalOutput = z.infer<typeof missionSessionTerminalOutputSchema>;
export type MissionSessionTerminalSnapshot = z.infer<typeof missionSessionTerminalSnapshotSchema>;
export type MissionSessionTerminalSocketClientMessage = z.infer<typeof missionSessionTerminalSocketClientMessageSchema>;
export type MissionSessionTerminalSocketServerMessage = z.infer<typeof missionSessionTerminalSocketServerMessageSchema>;
export type MissionTerminalOutput = z.infer<typeof missionTerminalOutputSchema>;
export type MissionTerminalSnapshot = z.infer<typeof missionTerminalSnapshotSchema>;
export type MissionTerminalSocketClientMessage = z.infer<typeof missionTerminalSocketClientMessageSchema>;
export type MissionTerminalSocketServerMessage = z.infer<typeof missionTerminalSocketServerMessageSchema>;
export type MissionRuntimeMissionCommandInput = z.infer<typeof missionRuntimeMissionCommandSchema>;
export type MissionRuntimeSessionCommandInput = z.infer<typeof missionRuntimeSessionCommandSchema>;
export type MissionRuntimeTaskCommandInput = z.infer<typeof missionRuntimeTaskCommandSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type MissionRuntimeSnapshot = z.infer<typeof missionRuntimeSnapshotSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type GitHubVisibleRepository = z.infer<typeof githubVisibleRepositorySchema>;
export type RepositorySnapshot = z.infer<typeof repositorySnapshotSchema>;
export type GitHubIssueDetail = z.infer<typeof githubIssueDetailSchema>;
export type MissionReference = z.infer<typeof missionReferenceSchema>;
export type TrackedIssueSummary = z.infer<typeof trackedIssueSummarySchema>;
