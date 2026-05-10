import * as path from 'node:path';
import type { EntityExecutionContext } from '../entities/Entity/Entity.js';
import { AgentRegistry } from '../entities/Agent/AgentRegistry.js';
import {
    MissionLocatorSchema,
    type MissionLocatorType
} from '../entities/Mission/MissionSchema.js';
import { Mission } from '../entities/Mission/Mission.js';
import { Repository } from '../entities/Repository/Repository.js';
import { MissionDossierFilesystem } from '../entities/Mission/MissionDossierFilesystem.js';
import { parsePersistedWorkflowSettings } from '../settings/validation.js';
import { readMissionWorkflowDefinition } from '../workflow/mission/preset.js';
import type {
    AgentExecutionObservation,
    AgentExecutionObservationAddress,
    AgentExecutionSignalDecision,
    AgentExecutionSnapshot
} from '../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { getAgentExecutionScopeMissionId } from '../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export type MissionLoader = (
    input: MissionLocatorType,
    context: { surfacePath: string },
    terminalName?: string
) => Promise<MissionHandle | undefined>;

export type MissionHandle = Mission;

export class MissionRegistry {
    private readonly missionLoads = new Map<string, Promise<MissionHandle | undefined>>();
    private readonly missionHandles = new Map<string, MissionHandle>();

    public constructor(private readonly options: {
        loadMission?: MissionLoader;
        logger?: {
            debug?(message: string, metadata?: Record<string, unknown>): void;
            info(message: string, metadata?: Record<string, unknown>): void;
            warn(message: string, metadata?: Record<string, unknown>): void;
        };
    } = {}) { }

    public async hydrateDaemonMissions(context: { surfacePath: string }): Promise<void> {
        const roots = new Set<string>([path.resolve(context.surfacePath)]);
        for (const repository of await Repository.find({}, context)) {
            if (repository.invalidState) {
                this.options.logger?.warn(`Mission daemon skipped invalid Repository '${repository.id}'.`, {
                    repositoryId: repository.id,
                    repositoryRootPath: repository.repositoryRootPath,
                    invalidState: repository.invalidState
                });
                continue;
            }
            roots.add(path.resolve(repository.repositoryRootPath));
        }

        for (const repositoryRoot of roots) {
            await this.hydrateRepositoryMissions({ surfacePath: repositoryRoot });
        }
    }

    public async hydrateRepositoryMissions(context: { surfacePath: string }): Promise<void> {
        const repositoryRoot = path.resolve(context.surfacePath);
        const adapter = new MissionDossierFilesystem(repositoryRoot);
        const missions = await this.listKnownMissions(adapter);
        await Promise.all(
            missions.map(async (mission) => {
                try {
                    const missionRepositoryRoot = adapter.getMissionWorkspacePath(mission.missionDir);
                    await this.loadMissionFromRegistry(
                        {
                            missionId: mission.descriptor.missionId,
                            repositoryRootPath: missionRepositoryRoot
                        },
                        { surfacePath: missionRepositoryRoot }
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

    public readRuntimeSummary(): { loadedMissionCount: number; loadedRepositoryCount: number } {
        const repositoryRoots = new Set<string>();
        for (const key of this.missionHandles.keys()) {
            const separatorIndex = key.lastIndexOf(':');
            if (separatorIndex > 0) {
                repositoryRoots.add(key.slice(0, separatorIndex));
            }
        }
        return {
            loadedMissionCount: this.missionHandles.size,
            loadedRepositoryCount: repositoryRoots.size
        };
    }

    public getRuntimeAgentExecutionSnapshot(address: AgentExecutionObservationAddress): AgentExecutionSnapshot | undefined {
        const missionId = getAgentExecutionScopeMissionId(address.scope);
        const mission = missionId ? this.findLoadedMission(missionId) : undefined;
        return mission?.getRuntimeAgentExecutionSnapshot(address.agentExecutionId);
    }

    public applyRuntimeAgentExecutionSignalDecision(input: {
        address: AgentExecutionObservationAddress;
        observation: AgentExecutionObservation;
        decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>;
    }): AgentExecutionSnapshot | undefined {
        const missionId = getAgentExecutionScopeMissionId(input.address.scope);
        const mission = missionId ? this.findLoadedMission(missionId) : undefined;
        return mission?.applyRuntimeAgentExecutionSignalDecision(
            input.address.agentExecutionId,
            input.observation,
            input.decision
        );
    }

    public async loadRequiredMission(
        input: MissionLocatorType,
        context: { surfacePath: string },
        terminalName?: string
    ): Promise<MissionHandle> {
        const payload = MissionLocatorSchema.parse({
            missionId: input.missionId,
            ...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
        });
        if (!context.surfacePath.trim()) {
            throw new Error('Mission entity methods require a surfacePath context.');
        }

        const mission = await this.loadMissionFromRegistry(payload, context, terminalName);
        if (!mission) {
            throw new Error(`Mission '${payload.missionId}' could not be resolved.`);
        }

        return this.createBorrowedMissionHandle(mission);
    }

    private async loadMissionFromRegistry(
        input: MissionLocatorType,
        context: { surfacePath: string },
        terminalName?: string
    ): Promise<MissionHandle | undefined> {
        const repositoryRoot = path.resolve(input.repositoryRootPath?.trim() || context.surfacePath);
        const key = this.createMissionKey(repositoryRoot, input.missionId);
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
            { surfacePath: repositoryRoot },
            terminalName
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
        const repositoryRoot = input.repositoryRootPath?.trim() || context.surfacePath;
        const settings = Repository.requireSettingsDocument(repositoryRoot);
        const workflowDocument = readMissionWorkflowDefinition(repositoryRoot);
        if (!workflowDocument) {
            throw new Error(`Repository workflow definition '${Repository.getMissionWorkflowDefinitionPath(repositoryRoot)}' is required.`);
        }
        const workflow = parsePersistedWorkflowSettings(workflowDocument);
        const agentRegistry = await AgentRegistry.createConfigured({
            repositoryRootPath: repositoryRoot
        });

        const adapter = new MissionDossierFilesystem(repositoryRoot);
        const resolved = await adapter.resolveKnownMission({ missionId: input.missionId });
        if (!resolved) {
            return undefined;
        }

        const mission = new Mission(adapter, resolved.missionDir, resolved.descriptor, {
            workflow,
            resolveWorkflow: () => workflow,
            agentRegistry,
            ...(settings.instructionsPath
                ? { instructionsPath: resolveRepositoryPath(repositoryRoot, settings.instructionsPath) }
                : {}),
            ...(settings.skillsPath ? { skillsPath: resolveRepositoryPath(repositoryRoot, settings.skillsPath) } : {}),
            ...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
            ...(settings.defaultReasoningEffort ? { defaultReasoningEffort: settings.defaultReasoningEffort } : {}),
            ...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {}),
            ...(this.options.logger ? { logger: this.options.logger } : {})
        });
        await mission.refresh();
        return mission;
    };

    private async listKnownMissions(adapter: MissionDossierFilesystem) {
        const missions = [
            ...await adapter.listTrackedMissions(),
            ...await adapter.listMissions()
        ];
        const uniqueMissions = [...new Map(missions.map((mission) => [mission.missionDir, mission])).values()];
        const hydratableMissions = [];
        for (const mission of uniqueMissions) {
            if (await this.shouldHydrateMission(adapter, mission.missionDir)) {
                hydratableMissions.push(mission);
            }
        }
        return hydratableMissions;
    }

    private async shouldHydrateMission(adapter: MissionDossierFilesystem, missionDir: string): Promise<boolean> {
        const stateData = await adapter.readMissionStateDataFile(missionDir);
        if (!isRecord(stateData) || !isRecord(stateData['runtime'])) {
            return true;
        }

        const lifecycle = stateData['runtime']['lifecycle'];
        return lifecycle !== 'completed' && lifecycle !== 'delivered';
    }

    private createMissionKey(repositoryRoot: string, missionId: string): string {
        return `${path.resolve(repositoryRoot)}:${missionId}`;
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

    private findLoadedMission(missionId: string): MissionHandle | undefined {
        for (const mission of this.missionHandles.values()) {
            if (mission.missionId === missionId) {
                return mission;
            }
        }
        return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
