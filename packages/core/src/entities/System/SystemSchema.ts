import { z } from 'zod/v4';
import { AgentOwnerSettingsSchema } from '../Agent/AgentSchema.js';

export const DEFAULT_SYSTEM_AGENT_ADAPTER_ID = 'codex';

export const SystemAgentSettingsSchema = AgentOwnerSettingsSchema;

export const githubSystemStateSchema = z.object({
    cliAvailable: z.boolean(),
    authenticated: z.boolean(),
    user: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    avatarUrl: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional()
}).strict();

export const systemConfigSchema = SystemAgentSettingsSchema.extend({
    repositoriesRoot: z.string().trim().min(1)
}).strict();

export const SystemRepositoriesSettingsSchema = z.object({
    repositoriesRoot: systemConfigSchema.shape.repositoriesRoot
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
    orphanedRuntimeLeases: z.number().int().nonnegative(),
    surreal: z.object({
        available: z.boolean(),
        engine: z.enum(['mem', 'surrealkv']),
        namespace: z.string().trim().min(1),
        database: z.string().trim().min(1),
        storagePath: z.string().trim().min(1).optional(),
        connectedAt: z.string().trim().min(1).optional(),
        detail: z.string().trim().min(1).optional()
    }).strict().optional()
}).strict();

export const systemDiagnosticsStateSchema = z.object({
    sampledAt: z.string().trim().min(1),
    statusCacheTtlMs: z.number().int().nonnegative()
}).strict();

export const systemStateSchema = z.object({
    sampledAt: z.string().trim().min(1),
    github: githubSystemStateSchema,
    config: systemConfigSchema,
    daemon: daemonSystemStateSchema,
    host: hostSystemStateSchema,
    runtime: runtimeSystemStateSchema,
    diagnostics: systemDiagnosticsStateSchema
}).strict();

const defaultSystemAgentSettings: SystemAgentSettingsType = {
    defaultAgentAdapter: DEFAULT_SYSTEM_AGENT_ADAPTER_ID,
    enabledAgentAdapters: []
};

export const systemEntityName = 'System' as const;

export const SystemReadSchema = z.object({}).strict();
export const SystemConfigureSchema = SystemRepositoriesSettingsSchema;
export const SystemDataSchema = systemConfigSchema;

export function createDefaultSystemAgentSettings(): SystemAgentSettingsType {
    return structuredClone(defaultSystemAgentSettings);
}

export function parseSystemAgentSettings(input: Partial<SystemAgentSettingsType> = {}): SystemAgentSettingsType {
    const defaults = createDefaultSystemAgentSettings();
    return SystemAgentSettingsSchema.parse({
        defaultAgentAdapter: input.defaultAgentAdapter ?? defaults.defaultAgentAdapter,
        enabledAgentAdapters: input.enabledAgentAdapters ?? defaults.enabledAgentAdapters,
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
        ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
        ...(input.defaultReasoningEffort ? { defaultReasoningEffort: input.defaultReasoningEffort } : {})
    });
}

export type SystemAgentSettingsType = z.infer<typeof SystemAgentSettingsSchema>;
export type GithubSystemState = z.infer<typeof githubSystemStateSchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type SystemRepositoriesSettingsType = z.infer<typeof SystemRepositoriesSettingsSchema>;
export type DaemonSystemState = z.infer<typeof daemonSystemStateSchema>;
export type HostSystemState = z.infer<typeof hostSystemStateSchema>;
export type RuntimeSystemState = z.infer<typeof runtimeSystemStateSchema>;
export type SystemDiagnosticsState = z.infer<typeof systemDiagnosticsStateSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;
export type SystemReadType = z.infer<typeof SystemReadSchema>;
export type SystemConfigureType = z.infer<typeof SystemConfigureSchema>;
export type SystemDataType = z.infer<typeof SystemDataSchema>;