// /packages/core/src/airport/runtime.ts: Shared runtime API contracts and validators for Airport web surfaces.
import { z } from 'zod';
import {
    missionReferenceSchema,
    repositorySchema
} from '../entities/Repository/RepositorySchema.js';

export {
    missionReferenceSchema,
    repositorySchema
};

const missionTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);

export const airportRuntimeEventTypeSchema = z.enum([
    'airport.state',
    'mission.actions.changed',
    'mission.status',
    'session.console',
    'session.terminal',
    'session.event',
    'session.lifecycle'
]);

export const missionRuntimeRouteParamsSchema = z.object({
    missionId: z.string().trim().min(1)
});

const agentMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

const agentMetadataSchema = z.record(z.string(), agentMetadataValueSchema);

export const agentPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentMetadataSchema.optional()
});

export const agentCommandSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interrupt'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }),
    z.object({
        type: z.literal('checkpoint'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }),
    z.object({
        type: z.literal('nudge'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    }),
    z.object({
        type: z.literal('resume'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentMetadataSchema.optional()
    })
]);

export const missionRuntimeTaskCommandSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('start'),
        terminalSessionName: z.string().trim().min(1).optional()
    }),
    z.object({ action: z.literal('complete') }),
    z.object({ action: z.literal('reopen') })
]);

export const missionRuntimeMissionCommandSchema = z.object({
    action: z.enum(['pause', 'resume', 'panic', 'clearPanic', 'restartQueue', 'deliver'])
});

export const missionRuntimeSessionCommandSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('complete')
    }),
    z.object({
        action: z.literal('cancel'),
        reason: z.string().trim().min(1).optional()
    }),
    z.object({
        action: z.literal('terminate'),
        reason: z.string().trim().min(1).optional()
    }),
    z.object({
        action: z.literal('prompt'),
        prompt: agentPromptSchema
    }),
    z.object({
        action: z.literal('command'),
        command: agentCommandSchema
    })
]);

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

export const repositoryRegistrationInputSchema = z.object({
    repositoryPath: z.string().trim().min(1)
});

export const githubVisibleRepositorySchema = z.object({
    fullName: z.string().trim().min(1),
    ownerLogin: z.string().trim().min(1).optional(),
    htmlUrl: z.string().trim().url().optional(),
    visibility: z.enum(['private', 'public']),
    archived: z.boolean()
});

export const missionFromIssueInputSchema = z.object({
    issueNumber: z.coerce.number().int().positive()
});

export const missionFromBriefInputSchema = z.object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    type: missionTypeSchema
});

export const airportRuntimeEventsQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional()
});

export const repositoryRouteQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional(),
    issueNumber: z.coerce.number().int().positive().optional()
});

export const artifactSchema = z.object({
    artifactId: z.string().trim().min(1),
    kind: z.enum(['mission', 'stage', 'task']),
    label: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    key: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
});

export const taskSchema = z.object({
    taskId: z.string().trim().min(1),
    stageId: z.string().trim().min(1),
    sequence: z.number().int().positive(),
    title: z.string().trim().min(1),
    instruction: z.string(),
    lifecycle: z.string().trim().min(1),
    dependsOn: z.array(z.string().trim().min(1)),
    waitingOnTaskIds: z.array(z.string().trim().min(1)),
    agentRunner: z.string().trim().min(1),
    retries: z.number().int().nonnegative(),
    fileName: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
});

export const stageSchema = z.object({
    stageId: z.string().trim().min(1),
    lifecycle: z.string().trim().min(1),
    isCurrentStage: z.boolean(),
    artifacts: z.array(artifactSchema),
    tasks: z.array(taskSchema)
});

export const missionSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional(),
    type: missionTypeSchema.optional(),
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    missionDir: z.string().trim().min(1).optional(),
    missionRootDir: z.string().trim().min(1).optional(),
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    artifacts: z.array(artifactSchema),
    stages: z.array(stageSchema),
    agentSessions: z.array(z.lazy(() => agentSessionSchema)).optional(),
    recommendedAction: z.string().trim().min(1).optional()
});

export const missionWorkflowSummarySchema = z.object({
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    stages: z.array(stageSchema).optional()
});

export const missionStatusSummarySchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    issueId: z.number().int().positive().optional(),
    type: missionTypeSchema.optional(),
    operationalMode: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    missionDir: z.string().trim().min(1).optional(),
    missionRootDir: z.string().trim().min(1).optional(),
    artifacts: z.array(artifactSchema).optional(),
    workflow: missionWorkflowSummarySchema.optional(),
    recommendedAction: z.string().trim().min(1).optional()
});

export const trackedIssueSummarySchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
});

export const githubIssueDetailSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    body: z.string(),
    url: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
});

export const airportHomeSnapshotSchema = z.object({
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    repositories: z.array(repositorySchema),
    selectedRepositoryRoot: z.string().trim().min(1).optional()
});

export const repositorySnapshotSchema = z.object({
    repository: repositorySchema,
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    githubRepository: z.string().trim().min(1).optional(),
    missions: z.array(missionReferenceSchema),
    selectedMissionId: z.string().trim().min(1).optional(),
    selectedMission: z.lazy(() => missionRuntimeSnapshotSchema).optional(),
    selectedIssue: githubIssueDetailSchema.optional()
});

export const missionSessionTerminalHandleSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
});

export const agentSessionSchema = z.object({
    sessionId: z.string().trim().min(1),
    runnerId: z.string().trim().min(1),
    transportId: z.string().trim().min(1).optional(),
    runnerLabel: z.string().trim().min(1),
    sessionLogPath: z.string().trim().min(1).optional(),
    lifecycleState: z.enum([
        'starting',
        'running',
        'awaiting-input',
        'completed',
        'failed',
        'cancelled',
        'terminated'
    ]),
    terminalSessionName: z.string().trim().min(1).optional(),
    terminalPaneId: z.string().trim().min(1).optional(),
    terminalHandle: missionSessionTerminalHandleSchema.optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional()
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

export const missionRuntimeSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    status: missionStatusSummarySchema,
    sessions: z.array(agentSessionSchema)
});

export const airportRuntimeEventEnvelopeSchema = z.object({
    eventId: z.string().trim().min(1),
    type: airportRuntimeEventTypeSchema,
    occurredAt: z.string().trim().min(1),
    missionId: z.string().trim().min(1).optional(),
    payload: z.unknown()
});

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
