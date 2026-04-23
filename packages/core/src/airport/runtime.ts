// /packages/core/src/airport/runtime.ts: Shared runtime API contracts and validators for Airport web surfaces.
import { z } from 'zod';

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

export const githubVisibleRepositoryDtoSchema = z.object({
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

export const missionWorkflowSummaryDtoSchema = z.object({
    lifecycle: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    currentStageId: z.string().trim().min(1).optional(),
    stages: z.array(
        z.object({
            stageId: z.string().trim().min(1),
            lifecycle: z.string().trim().min(1),
            isCurrentStage: z.boolean(),
            artifacts: z.array(
                z.object({
                    key: z.string().trim().min(1),
                    label: z.string().trim().min(1),
                    fileName: z.string().trim().min(1)
                })
            ),
            tasks: z.array(
                z.object({
                    taskId: z.string().trim().min(1),
                    title: z.string().trim().min(1),
                    lifecycle: z.string().trim().min(1),
                    dependsOn: z.array(z.string().trim().min(1)),
                    waitingOnTaskIds: z.array(z.string().trim().min(1))
                })
            )
        })
    ).optional()
});

export const missionStatusSummaryDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    operationalMode: z.string().trim().min(1).optional(),
    workflow: missionWorkflowSummaryDtoSchema.optional()
});

export const repositoryCandidateDtoSchema = z.object({
    repositoryId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string(),
    githubRepository: z.string().trim().min(1).optional()
});

export const missionSelectionCandidateDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    branchRef: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    issueId: z.number().int().positive().optional()
});

export const trackedIssueSummaryDtoSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
});

export const githubIssueDetailDtoSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    body: z.string(),
    url: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
});

export const airportHomeSnapshotDtoSchema = z.object({
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    repositories: z.array(repositoryCandidateDtoSchema),
    selectedRepositoryRoot: z.string().trim().min(1).optional()
});

export const repositorySurfaceSnapshotDtoSchema = z.object({
    repository: repositoryCandidateDtoSchema,
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    githubRepository: z.string().trim().min(1).optional(),
    missions: z.array(missionSelectionCandidateDtoSchema),
    selectedMissionId: z.string().trim().min(1).optional(),
    selectedMission: z.lazy(() => missionRuntimeSnapshotDtoSchema).optional(),
    selectedIssue: githubIssueDetailDtoSchema.optional()
});

export const missionSessionTerminalHandleDtoSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
});

export const missionAgentSessionDtoSchema = z.object({
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
    terminalHandle: missionSessionTerminalHandleDtoSchema.optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional()
});

export const missionSessionTerminalSnapshotDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleDtoSchema.optional()
});

export const missionTerminalSnapshotDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleDtoSchema.optional()
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

export const missionSessionTerminalOutputDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleDtoSchema.optional()
});

export const missionSessionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionSessionTerminalSnapshotDtoSchema
    }),
    z.object({
        type: z.literal('output'),
        output: missionSessionTerminalOutputDtoSchema
    }),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionSessionTerminalSnapshotDtoSchema
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

export const missionTerminalOutputDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: missionSessionTerminalHandleDtoSchema.optional()
});

export const missionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: missionTerminalSnapshotDtoSchema
    }),
    z.object({
        type: z.literal('output'),
        output: missionTerminalOutputDtoSchema
    }),
    z.object({
        type: z.literal('disconnected'),
        snapshot: missionTerminalSnapshotDtoSchema
    }),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    })
]);

export const missionRuntimeSnapshotDtoSchema = z.object({
    missionId: z.string().trim().min(1),
    status: missionStatusSummaryDtoSchema,
    sessions: z.array(missionAgentSessionDtoSchema)
});

export const airportRuntimeEventEnvelopeSchema = z.object({
    eventId: z.string().trim().min(1),
    type: airportRuntimeEventTypeSchema,
    occurredAt: z.string().trim().min(1),
    missionId: z.string().trim().min(1).optional(),
    payload: z.unknown()
});

export type AirportRuntimeEventEnvelopeDto = z.infer<typeof airportRuntimeEventEnvelopeSchema>;
export type AirportRuntimeEventType = z.infer<typeof airportRuntimeEventTypeSchema>;
export type AgentCommandDto = z.infer<typeof agentCommandSchema>;
export type AgentPromptDto = z.infer<typeof agentPromptSchema>;
export type AirportHomeSnapshotDto = z.infer<typeof airportHomeSnapshotDtoSchema>;
export type MissionAgentSessionDto = z.infer<typeof missionAgentSessionDtoSchema>;
export type MissionSessionTerminalHandleDto = z.infer<typeof missionSessionTerminalHandleDtoSchema>;
export type MissionSessionTerminalOutputDto = z.infer<typeof missionSessionTerminalOutputDtoSchema>;
export type MissionSessionTerminalSnapshotDto = z.infer<typeof missionSessionTerminalSnapshotDtoSchema>;
export type MissionSessionTerminalSocketClientMessageDto = z.infer<typeof missionSessionTerminalSocketClientMessageSchema>;
export type MissionSessionTerminalSocketServerMessageDto = z.infer<typeof missionSessionTerminalSocketServerMessageSchema>;
export type MissionTerminalOutputDto = z.infer<typeof missionTerminalOutputDtoSchema>;
export type MissionTerminalSnapshotDto = z.infer<typeof missionTerminalSnapshotDtoSchema>;
export type MissionTerminalSocketClientMessageDto = z.infer<typeof missionTerminalSocketClientMessageSchema>;
export type MissionTerminalSocketServerMessageDto = z.infer<typeof missionTerminalSocketServerMessageSchema>;
export type MissionSelectionCandidateDto = z.infer<typeof missionSelectionCandidateDtoSchema>;
export type MissionRuntimeMissionCommandInputDto = z.infer<typeof missionRuntimeMissionCommandSchema>;
export type MissionRuntimeSessionCommandInputDto = z.infer<typeof missionRuntimeSessionCommandSchema>;
export type MissionRuntimeTaskCommandInputDto = z.infer<typeof missionRuntimeTaskCommandSchema>;
export type MissionRuntimeSnapshotDto = z.infer<typeof missionRuntimeSnapshotDtoSchema>;
export type RepositoryCandidateDto = z.infer<typeof repositoryCandidateDtoSchema>;
export type GitHubVisibleRepositoryDto = z.infer<typeof githubVisibleRepositoryDtoSchema>;
export type RepositorySurfaceSnapshotDto = z.infer<typeof repositorySurfaceSnapshotDtoSchema>;
export type GitHubIssueDetailDto = z.infer<typeof githubIssueDetailDtoSchema>;
export type TrackedIssueSummaryDto = z.infer<typeof trackedIssueSummaryDtoSchema>;
