import { z } from 'zod/v4';

export const githubSystemStateSchema = z.object({
    cliAvailable: z.boolean(),
    authenticated: z.boolean(),
    user: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    avatarUrl: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional()
}).strict();

export const missionSystemConfigSchema = z.object({
    repositoriesRoot: z.string().trim().min(1)
}).strict();

export const daemonSystemStateSchema = z.object({
    pid: z.number().int().positive(),
    startedAt: z.string().trim().min(1),
    uptimeMs: z.number().int().nonnegative(),
    protocolVersion: z.number().int().positive(),
    runtimePath: z.string().trim().min(1),
    socketPath: z.string().trim().min(1).optional()
}).strict();

export const hostSystemStateSchema = z.object({
    platform: z.string().trim().min(1),
    arch: z.string().trim().min(1),
    nodeVersion: z.string().trim().min(1),
    loadAverage: z.array(z.number()).length(3),
    memory: z.object({
        rss: z.number().int().nonnegative(),
        heapTotal: z.number().int().nonnegative(),
        heapUsed: z.number().int().nonnegative(),
        external: z.number().int().nonnegative(),
        systemTotal: z.number().int().nonnegative(),
        systemFree: z.number().int().nonnegative()
    }).strict()
}).strict();

export const runtimeSystemStateSchema = z.object({
    loadedRepositories: z.number().int().nonnegative(),
    loadedMissions: z.number().int().nonnegative(),
    activeAgentExecutions: z.number().int().nonnegative(),
    attachedAgentExecutions: z.number().int().nonnegative(),
    detachedAgentExecutions: z.number().int().nonnegative(),
    degradedAgentExecutions: z.number().int().nonnegative(),
    protocolIncompatibleAgentExecutions: z.number().int().nonnegative(),
    agentExecutionsWithoutRuntimeLease: z.number().int().nonnegative(),
    runtimeLeasesWithoutAgentExecution: z.number().int().nonnegative(),
    terminalLeasesWithoutOwner: z.number().int().nonnegative(),
    reconciliationRequired: z.boolean(),
    supervisionOwners: z.number().int().nonnegative(),
    supervisionRelationships: z.number().int().nonnegative(),
    runtimeLeases: z.number().int().nonnegative(),
    activeRuntimeLeases: z.number().int().nonnegative(),
    activeTerminalLeases: z.number().int().nonnegative(),
    orphanedRuntimeLeases: z.number().int().nonnegative()
}).strict();

export const systemDiagnosticsStateSchema = z.object({
    sampledAt: z.string().trim().min(1),
    statusCacheTtlMs: z.number().int().nonnegative()
}).strict();

export const systemStateSchema = z.object({
    sampledAt: z.string().trim().min(1),
    github: githubSystemStateSchema,
    config: missionSystemConfigSchema,
    daemon: daemonSystemStateSchema,
    host: hostSystemStateSchema,
    runtime: runtimeSystemStateSchema,
    diagnostics: systemDiagnosticsStateSchema
}).strict();

export type GithubSystemState = z.infer<typeof githubSystemStateSchema>;
export type MissionSystemConfig = z.infer<typeof missionSystemConfigSchema>;
export type DaemonSystemState = z.infer<typeof daemonSystemStateSchema>;
export type HostSystemState = z.infer<typeof hostSystemStateSchema>;
export type RuntimeSystemState = z.infer<typeof runtimeSystemStateSchema>;
export type SystemDiagnosticsState = z.infer<typeof systemDiagnosticsStateSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;