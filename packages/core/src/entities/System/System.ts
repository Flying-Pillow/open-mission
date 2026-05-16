import * as fs from 'node:fs/promises';
import { Entity } from '../Entity/Entity.js';
import {
    getDefaultOpenMissionConfig,
    readOpenMissionConfig,
    writeOpenMissionConfig
} from '../../settings/OpenMissionInstall.js';
import {
    SystemConfigureSchema,
    SystemDataSchema,
    SystemReadSchema,
    systemEntityName,
    systemSingletonId,
    SystemAgentSettingsSchema,
    type SystemAgentSettingsType,
    type SystemDataType,
    type SystemStorageType
} from './SystemSchema.js';
import type { EntityExecutionContext } from '../Entity/Entity.js';

export class System extends Entity<SystemDataType, string> {
    public static override readonly entityName = systemEntityName;
    public static readonly storageSchema = SystemDataSchema;

    public constructor(data: SystemDataType) {
        super(SystemDataSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public static async read(payload: unknown, context?: EntityExecutionContext): Promise<SystemDataType> {
        SystemReadSchema.parse(payload);
        return (await System.ensureRecord(context)).toData();
    }

    public static async configure(payload: unknown, context?: EntityExecutionContext): Promise<SystemDataType> {
        const input = SystemConfigureSchema.parse(payload);
        const current = await System.ensureRecord(context);
        const next = new System(SystemDataSchema.parse({
            ...current.toData(),
            ...(input.repositoriesRoot ? { repositoriesRoot: input.repositoriesRoot } : {}),
            ...(input.missionsRoot ? { missionsRoot: input.missionsRoot } : {}),
            ...(input.ghBinary !== undefined ? { ghBinary: input.ghBinary ?? undefined } : {})
        }));
        await next.save(context);
        await mirrorSystemRecordToConfig(next.toData());
        return next.toData();
    }

    public static async configureAgent(payload: unknown, context?: EntityExecutionContext): Promise<SystemDataType> {
        const input: SystemAgentSettingsType = SystemAgentSettingsSchema.parse(payload);
        const current = await System.ensureRecord(context);
        const defaultAgentChanged = current.data.defaultAgentAdapter !== input.defaultAgentAdapter;
        const next = new System(SystemDataSchema.parse({
            ...current.toData(),
            ...input,
            defaultAgentMode: input.defaultAgentMode ?? current.data.defaultAgentMode,
            defaultModel: input.defaultModel ?? (defaultAgentChanged ? undefined : current.data.defaultModel),
            defaultReasoningEffort: input.defaultReasoningEffort ?? (defaultAgentChanged ? undefined : current.data.defaultReasoningEffort)
        }));
        await next.save(context);
        await mirrorSystemRecordToConfig(next.toData());
        return next.toData();
    }

    public static async readCurrentPackageVersion(): Promise<string> {
        return readPackageVersion();
    }

    private static async ensureRecord(context?: EntityExecutionContext): Promise<System> {
        const existing = await System.getEntityFactory(context).read(System, systemSingletonId);
        if (existing) {
            return existing;
        }

        const created = await System.getEntityFactory(context).save(System, await buildDefaultSystemRecord());
        await mirrorSystemRecordToConfig(created.toData());
        return created;
    }
}

async function buildDefaultSystemRecord(): Promise<SystemStorageType> {
    const current = readOpenMissionConfig() ?? getDefaultOpenMissionConfig();
    return SystemDataSchema.parse({
        id: systemSingletonId,
        repositoriesRoot: current.repositoriesRoot,
        missionsRoot: current.missionsRoot,
        defaultAgentAdapter: current.defaultAgentAdapter,
        enabledAgentAdapters: current.enabledAgentAdapters,
        ...(current.defaultAgentMode ? { defaultAgentMode: current.defaultAgentMode } : {}),
        ...(current.defaultModel ? { defaultModel: current.defaultModel } : {}),
        ...(current.defaultReasoningEffort ? { defaultReasoningEffort: current.defaultReasoningEffort } : {}),
        ...(current.ghBinary ? { ghBinary: current.ghBinary } : {}),
        packageVersion: await readPackageVersion()
    });
}

async function mirrorSystemRecordToConfig(system: SystemDataType): Promise<void> {
    await writeOpenMissionConfig({
        missionsRoot: system.missionsRoot,
        repositoriesRoot: system.repositoriesRoot,
        defaultAgentAdapter: system.defaultAgentAdapter,
        enabledAgentAdapters: system.enabledAgentAdapters,
        ...(system.defaultAgentMode ? { defaultAgentMode: system.defaultAgentMode } : {}),
        ...(system.defaultModel ? { defaultModel: system.defaultModel } : {}),
        ...(system.defaultReasoningEffort ? { defaultReasoningEffort: system.defaultReasoningEffort } : {}),
        ...(system.ghBinary ? { ghBinary: system.ghBinary } : {})
    });
}

let packageVersionPromise: Promise<string> | undefined;

async function readPackageVersion(): Promise<string> {
    packageVersionPromise ??= (async () => {
        const packageJsonUrl = new URL('../../../package.json', import.meta.url);
        const content = await fs.readFile(packageJsonUrl, 'utf8');
        const parsed = JSON.parse(content) as { version?: unknown };
        if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
            throw new Error('Open Mission core package.json is missing a version string.');
        }
        return parsed.version.trim();
    })();

    return packageVersionPromise;
}