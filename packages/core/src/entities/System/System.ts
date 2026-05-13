import { Entity } from '../Entity/Entity.js';
import {
    getDefaultMissionConfig,
    readMissionConfig,
    resolveRepositoriesRoot,
    writeMissionConfig
} from '../../settings/MissionInstall.js';
import {
    SystemConfigureSchema,
    SystemDataSchema,
    SystemReadSchema,
    systemEntityName,
    SystemAgentSettingsSchema,
    type SystemAgentSettingsType,
    type SystemDataType
} from './SystemSchema.js';

export class System extends Entity<SystemDataType, string> {
    public static override readonly entityName = systemEntityName;

    public constructor(data: SystemDataType) {
        super(SystemDataSchema.parse(data));
    }

    public override get id(): string {
        return 'system:config';
    }

    public static async read(payload: unknown): Promise<SystemDataType> {
        SystemReadSchema.parse(payload);
        return readSystemConfig();
    }

    public static async configure(payload: unknown): Promise<SystemDataType> {
        const input = SystemConfigureSchema.parse(payload);
        const current = readMissionConfig() ?? getDefaultMissionConfig();
        await writeMissionConfig({
            ...current,
            ...input
        });
        return readSystemConfig();
    }

    public static async configureAgent(payload: unknown): Promise<SystemDataType> {
        const input: SystemAgentSettingsType = SystemAgentSettingsSchema.parse(payload);
        const current = readMissionConfig() ?? getDefaultMissionConfig();
        const defaultAgentChanged = current.defaultAgentAdapter !== input.defaultAgentAdapter;
        await writeMissionConfig({
            ...current,
            ...input,
            defaultAgentMode: input.defaultAgentMode ?? current.defaultAgentMode,
            defaultModel: input.defaultModel ?? (defaultAgentChanged ? undefined : current.defaultModel),
            defaultReasoningEffort: input.defaultReasoningEffort ?? (defaultAgentChanged ? undefined : current.defaultReasoningEffort)
        });
        return readSystemConfig();
    }
}

function readSystemConfig(): SystemDataType {
    const config = readMissionConfig() ?? getDefaultMissionConfig();
    return SystemDataSchema.parse({
        repositoriesRoot: resolveRepositoriesRoot(config),
        defaultAgentAdapter: config.defaultAgentAdapter,
        enabledAgentAdapters: config.enabledAgentAdapters,
        ...(config.defaultAgentMode ? { defaultAgentMode: config.defaultAgentMode } : {}),
        ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
        ...(config.defaultReasoningEffort ? { defaultReasoningEffort: config.defaultReasoningEffort } : {})
    } satisfies SystemDataType);
}