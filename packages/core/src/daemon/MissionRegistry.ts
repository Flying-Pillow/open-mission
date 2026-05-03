import * as path from 'node:path';
import { createConfiguredAgentRunners } from './runtime/agent/runtimes/AgentRuntimeFactory.js';
import type { EntityExecutionContext } from '../entities/Entity/Entity.js';
import {
    MissionLocatorSchema,
    type MissionLocatorType
} from '../entities/Mission/MissionSchema.js';
import { Mission } from '../entities/Mission/Mission.js';
import { Repository } from '../entities/Repository/Repository.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { parsePersistedWorkflowSettings } from '../settings/validation.js';
import { readMissionWorkflowDefinition } from '../workflow/mission/preset.js';

export type MissionLoader = (
    input: MissionLocatorType,
    context: { surfacePath: string },
    terminalSessionName?: string
) => Promise<MissionHandle | undefined>;

export type MissionHandle = Mission;

export class MissionRegistry {
    private readonly missionLoads = new Map<string, Promise<MissionHandle | undefined>>();
    private readonly missionHandles = new Map<string, MissionHandle>();

    public constructor(private readonly options: {
        loadMission?: MissionLoader;
        logger?: {
            warn(message: string, metadata?: Record<string, unknown>): void;
        };
    } = {}) { }

    public async hydrateDaemonMissions(context: { surfacePath: string }): Promise<void> {
        const roots = new Set<string>([path.resolve(context.surfacePath)]);
        for (const repository of await Repository.find({}, context)) {
            roots.add(path.resolve(repository.repositoryRootPath));
        }

        for (const controlRoot of roots) {
            await this.hydrateRepositoryMissions({ surfacePath: controlRoot });
        }
    }

    public async hydrateRepositoryMissions(context: { surfacePath: string }): Promise<void> {
        const controlRoot = path.resolve(context.surfacePath);
        const adapter = new FilesystemAdapter(controlRoot);
        const missions = await this.listKnownMissions(adapter);
        await Promise.all(
            missions.map(async (mission) => {
                try {
                    const missionControlRoot = adapter.getMissionWorkspacePath(mission.missionDir);
                    await this.loadMissionFromRegistry(
                        {
                            missionId: mission.descriptor.missionId,
                            repositoryRootPath: missionControlRoot
                        },
                        { surfacePath: missionControlRoot }
                    );
                } catch (error) {
                    const message = `Mission daemon could not hydrate mission '${mission.descriptor.missionId}' at '${mission.missionDir}': ${error instanceof Error ? error.message : String(error)}`;
                    this.options.logger?.warn(message, {
                        missionId: mission.descriptor.missionId,
                        missionDir: mission.missionDir
                    });
                    console.error(
                        message
                    );
                }
            })
        );
    }

    public dispose(): void {
        for (const mission of this.missionHandles.values()) {
            mission.dispose();
        }
        this.missionHandles.clear();
        this.missionLoads.clear();
    }

    public async loadRequiredMission(
        input: MissionLocatorType,
        context: { surfacePath: string },
        terminalSessionName?: string
    ): Promise<MissionHandle> {
        const payload = MissionLocatorSchema.parse({
            missionId: input.missionId,
            ...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
        });
        if (!context.surfacePath.trim()) {
            throw new Error('Mission entity methods require a surfacePath context.');
        }

        const mission = await this.loadMissionFromRegistry(payload, context, terminalSessionName);
        if (!mission) {
            throw new Error(`Mission '${payload.missionId}' could not be resolved.`);
        }

        return this.createBorrowedMissionHandle(mission);
    }

    private async loadMissionFromRegistry(
        input: MissionLocatorType,
        context: { surfacePath: string },
        terminalSessionName?: string
    ): Promise<MissionHandle | undefined> {
        const controlRoot = path.resolve(input.repositoryRootPath?.trim() || context.surfacePath);
        const key = this.createMissionKey(controlRoot, input.missionId);
        const existingMission = this.missionHandles.get(key);
        if (existingMission) {
            return existingMission;
        }

        const existingLoad = this.missionLoads.get(key);
        if (existingLoad) {
            return existingLoad;
        }

        const loader = this.options.loadMission ?? this.loadMission;
        const load = loader(
            input,
            { surfacePath: controlRoot },
            terminalSessionName
        ).then((mission) => {
            if (!mission) {
                this.missionLoads.delete(key);
                return undefined;
            }
            this.missionHandles.set(key, mission);
            return mission;
        }).catch((error) => {
            this.missionLoads.delete(key);
            throw error;
        });
        this.missionLoads.set(key, load);
        return load;
    }

    private readonly loadMission = async (
        input: MissionLocatorType,
        context: { surfacePath: string },
    ): Promise<Mission | undefined> => {
        const controlRoot = input.repositoryRootPath?.trim() || context.surfacePath;
        const settings = Repository.requireSettingsDocument(controlRoot);
        const workflowDocument = readMissionWorkflowDefinition(controlRoot);
        if (!workflowDocument) {
            throw new Error(`Repository workflow definition '${Repository.getMissionWorkflowDefinitionPath(controlRoot)}' is required.`);
        }
        const workflow = parsePersistedWorkflowSettings(workflowDocument);
        const taskRunners = new Map(
            (await createConfiguredAgentRunners({
                controlRoot
            })).map((runner) => [runner.id, runner] as const)
        );

        const adapter = new FilesystemAdapter(controlRoot);
        const resolved = await adapter.resolveKnownMission({ missionId: input.missionId });
        if (!resolved) {
            return undefined;
        }

        const mission = new Mission(adapter, resolved.missionDir, resolved.descriptor, {
            workflow,
            resolveWorkflow: () => workflow,
            taskRunners,
            ...(settings.instructionsPath
                ? { instructionsPath: resolveRepositoryPath(controlRoot, settings.instructionsPath) }
                : {}),
            ...(settings.skillsPath ? { skillsPath: resolveRepositoryPath(controlRoot, settings.skillsPath) } : {}),
            ...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
            ...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {})
        });
        await mission.refresh();
        return mission;
    };

    private async listKnownMissions(adapter: FilesystemAdapter) {
        const missions = [
            ...await adapter.listTrackedMissions(),
            ...await adapter.listMissions()
        ];
        return [...new Map(missions.map((mission) => [mission.missionDir, mission])).values()];
    }

    private createMissionKey(controlRoot: string, missionId: string): string {
        return `${path.resolve(controlRoot)}:${missionId}`;
    }

    private createBorrowedMissionHandle(mission: MissionHandle): MissionHandle {
        return new Proxy(mission, {
            get(target, property) {
                if (property === 'dispose') {
                    return () => undefined;
                }
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

}

export function requireMissionRegistry(context: EntityExecutionContext): MissionRegistry {
    if (!context.missionRegistry) {
        throw new Error('Mission entity methods require a daemon-owned mission registry.');
    }
    return context.missionRegistry;
}

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repositoryRootPath, configuredPath);
}