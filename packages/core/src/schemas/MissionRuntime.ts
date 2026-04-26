import { z } from 'zod/v4';

export const missionTypeSchema = z.enum(['feature', 'fix', 'docs', 'refactor', 'task']);

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

export const missionRuntimeSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    status: missionStatusSummarySchema,
    sessions: z.array(agentSessionSchema)
});

export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentPrompt = z.infer<typeof agentPromptSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type MissionSessionTerminalHandle = z.infer<typeof missionSessionTerminalHandleSchema>;
export type MissionRuntimeMissionCommandInput = z.infer<typeof missionRuntimeMissionCommandSchema>;
export type MissionRuntimeSessionCommandInput = z.infer<typeof missionRuntimeSessionCommandSchema>;
export type MissionRuntimeTaskCommandInput = z.infer<typeof missionRuntimeTaskCommandSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type MissionRuntimeSnapshot = z.infer<typeof missionRuntimeSnapshotSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Task = z.infer<typeof taskSchema>;
