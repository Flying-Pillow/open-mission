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
    type SystemConfigureType,
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
        await writeMissionConfig(input);
        return readSystemConfig();
    }
}

function readSystemConfig(): SystemDataType {
    const config = readMissionConfig() ?? getDefaultMissionConfig();
    return SystemDataSchema.parse({
        repositoriesRoot: resolveRepositoriesRoot(config),
        defaultAgentAdapter: config.defaultAgentAdapter,
        enabledAgentAdapters: config.enabledAgentAdapters
    } satisfies SystemConfigureType);
}