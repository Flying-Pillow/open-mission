import { z } from 'zod/v4';

export const terminalEntityName = 'Terminal' as const;

export const TerminalHandleSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1).optional(),
    sharedTerminalName: z.string().trim().min(1).optional()
}).strict();

export const TerminalLocatorSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1).optional()
}).strict();

export const TerminalInputSchema = TerminalLocatorSchema.extend({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Terminal input requires data or a complete cols/rows resize payload.'
});

export const TerminalOwnerSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('mission'),
        missionId: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('task'),
        missionId: z.string().trim().min(1).optional(),
        taskId: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('agent-execution'),
        missionId: z.string().trim().min(1).optional(),
        taskId: z.string().trim().min(1).optional(),
        agentExecutionId: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('repository'),
        repositoryRootPath: z.string().trim().min(1)
    }).strict(),
    z.object({
        kind: z.literal('system'),
        label: z.string().trim().min(1).optional()
    }).strict()
]);

export const TerminalSnapshotSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    sharedTerminalName: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    owner: TerminalOwnerSchema.optional()
}).strict();

export type TerminalHandleType = z.infer<typeof TerminalHandleSchema>;
export type TerminalInputType = z.infer<typeof TerminalInputSchema>;
export type TerminalLocatorType = z.infer<typeof TerminalLocatorSchema>;
export type TerminalOwnerType = z.infer<typeof TerminalOwnerSchema>;
export type TerminalSnapshotType = z.infer<typeof TerminalSnapshotSchema>;