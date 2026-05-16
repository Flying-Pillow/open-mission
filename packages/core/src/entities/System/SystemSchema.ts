import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import { AgentOwnerSettingsSchema } from '../Agent/AgentSchema.js';
import { EntityIdSchema, EntityStorageSchema } from '../Entity/EntitySchema.js';

export const DEFAULT_SYSTEM_AGENT_ADAPTER_ID = 'codex';
export const systemEntityName = 'System' as const;
export const systemTableName = 'system' as const;
export const systemSingletonId = 'system:singleton' as const;

export const SystemAgentSettingsSchema = AgentOwnerSettingsSchema;

const systemPathSchema = z.string().trim().min(1);
const optionalSystemPathSchema = z.string().trim().min(1).optional();
const systemPackageVersionSchema = z.string().trim().min(1);

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

export const SystemStorageSchema = EntityStorageSchema.extend({
    id: EntityIdSchema.meta({
        description: 'Canonical singleton Entity id for the Open Mission system record.'
    }).register(field, {
        description: 'Canonical singleton Entity id for the Open Mission system record.'
    }),
    repositoriesRoot: systemPathSchema.meta({
        description: 'Filesystem root path where Repository discovery scans for checked-out repositories.'
    }).register(field, {
        description: 'Filesystem root path where Repository discovery scans for checked-out repositories.'
    }),
    missionsRoot: systemPathSchema.meta({
        description: 'Filesystem root path where Mission worktrees are materialized.'
    }).register(field, {
        description: 'Filesystem root path where Mission worktrees are materialized.'
    }),
    defaultAgentAdapter: SystemAgentSettingsSchema.shape.defaultAgentAdapter.meta({
        description: 'Default Agent adapter selected for system-scoped work.'
    }).register(field, {
        description: 'Default Agent adapter selected for system-scoped work.'
    }),
    enabledAgentAdapters: SystemAgentSettingsSchema.shape.enabledAgentAdapters.meta({
        description: 'Agent adapters enabled for system-scoped work.'
    }).register(field, {
        description: 'Agent adapters enabled for system-scoped work.'
    }),
    defaultAgentMode: SystemAgentSettingsSchema.shape.defaultAgentMode.meta({
        description: 'Optional default AgentExecution launch mode for system-scoped work.'
    }).register(field, {
        optional: true,
        description: 'Optional default AgentExecution launch mode for system-scoped work.'
    }),
    defaultModel: SystemAgentSettingsSchema.shape.defaultModel.meta({
        description: 'Optional default model name for system-scoped Agent launches.'
    }).register(field, {
        optional: true,
        description: 'Optional default model name for system-scoped Agent launches.'
    }),
    defaultReasoningEffort: SystemAgentSettingsSchema.shape.defaultReasoningEffort.meta({
        description: 'Optional default reasoning effort for system-scoped Agent launches.'
    }).register(field, {
        optional: true,
        description: 'Optional default reasoning effort for system-scoped Agent launches.'
    }),
    ghBinary: optionalSystemPathSchema.meta({
        description: 'Optional GitHub CLI binary path used for GitHub-backed system status checks and repository operations.'
    }).register(field, {
        optional: true,
        description: 'Optional GitHub CLI binary path used for GitHub-backed system status checks and repository operations.'
    }),
    packageVersion: systemPackageVersionSchema.meta({
        description: 'Open Mission package version recorded when the singleton system record was created.'
    }).register(field, {
        description: 'Open Mission package version recorded when the singleton system record was created.'
    })
}).strict().meta({
    description: 'Canonical persisted singleton system record for Open Mission.'
}).register(table, {
    table: systemTableName,
    schemafull: true,
    description: 'Canonical persisted singleton system records for Open Mission.'
});

export const SystemSettingsUpdateSchema = z.object({
    repositoriesRoot: systemPathSchema.optional().meta({
        description: 'Optional Repository root path update for the singleton system record.'
    }),
    missionsRoot: systemPathSchema.optional().meta({
        description: 'Optional Mission worktrees root path update for the singleton system record.'
    }),
    ghBinary: z.union([z.string().trim().min(1), z.null()]).optional().meta({
        description: 'Optional GitHub CLI binary override for the singleton system record. Null clears the stored override.'
    })
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
        engine: z.literal('remote'),
        namespace: z.string().trim().min(1),
        database: z.string().trim().min(1),
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

export const SystemReadSchema = z.object({}).strict();
export const SystemConfigureSchema = SystemSettingsUpdateSchema;
export const SystemDataSchema = SystemStorageSchema;

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
export type SystemSettingsUpdateType = z.infer<typeof SystemSettingsUpdateSchema>;
export type SystemStorageType = z.infer<typeof SystemStorageSchema>;
export type DaemonSystemState = z.infer<typeof daemonSystemStateSchema>;
export type HostSystemState = z.infer<typeof hostSystemStateSchema>;
export type RuntimeSystemState = z.infer<typeof runtimeSystemStateSchema>;
export type SystemDiagnosticsState = z.infer<typeof systemDiagnosticsStateSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;
export type SystemReadType = z.infer<typeof SystemReadSchema>;
export type SystemConfigureType = z.infer<typeof SystemConfigureSchema>;
export type SystemDataType = z.infer<typeof SystemDataSchema>;