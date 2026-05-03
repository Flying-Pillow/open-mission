import * as path from 'node:path';
import type { AgentCommand, AgentPrompt } from './runtime/agent/AgentRuntimeTypes.js';
import { createConfiguredAgentRunners } from './runtime/agent/runtimes/AgentRuntimeFactory.js';
import type { EntityExecutionContext } from '../entities/Entity/Entity.js';
import type {
    AgentSessionCommandType,
    AgentSessionPromptType
} from '../entities/AgentSession/AgentSessionSchema.js';
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

export type MissionHandle = Pick<
    Mission,
    | 'command'
    | 'clearMissionPanic'
    | 'completeAgentSession'
    | 'completeTask'
    | 'dispose'
    | 'ensureTerminal'
    | 'cancelAgentSession'
    | 'deliver'
    | 'generateTasksForStage'
    | 'buildMissionSnapshot'
    | 'panicStopMission'
    | 'pauseMission'
    | 'read'
    | 'readDocument'
    | 'readControlView'
    | 'readTerminal'
    | 'readWorktree'
    | 'reopenTask'
    | 'restartLaunchQueue'
    | 'resumeMission'
    | 'reworkTask'
    | 'reworkTaskFromVerification'
    | 'sendAgentSessionCommand'
    | 'sendAgentSessionPrompt'
    | 'sendTerminalInput'
    | 'startTask'
    | 'setTaskAutostart'
    | 'terminateAgentSession'
    | 'toEntity'
    | 'writeDocument'
>;

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

        return this.toRequestMissionHandle(mission);
    }

    public getTerminalSessionName(input: unknown): string | undefined {
        if (!isRecord(input) || typeof input['terminalSessionName'] !== 'string') {
            return undefined;
        }
        const terminalSessionName = input['terminalSessionName'].trim();
        return terminalSessionName.length > 0 ? terminalSessionName : undefined;
    }

    public getReason(input: unknown): string | undefined {
        if (!isRecord(input) || typeof input['reason'] !== 'string') {
            return undefined;
        }
        const reason = input['reason'].trim();
        return reason.length > 0 ? reason : undefined;
    }

    public normalizeAgentPrompt(input: AgentSessionPromptType): AgentPrompt {
        return {
            source: input.source,
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {})
        };
    }

    public normalizeAgentCommand(input: AgentSessionCommandType): AgentCommand {
        return {
            type: input.type,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {})
        };
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

    private toRequestMissionHandle(mission: MissionHandle): MissionHandle {
        return {
            clearMissionPanic: mission.clearMissionPanic.bind(mission),
            command: mission.command.bind(mission),
            completeAgentSession: mission.completeAgentSession.bind(mission),
            completeTask: mission.completeTask.bind(mission),
            dispose: () => undefined,
            ensureTerminal: mission.ensureTerminal.bind(mission),
            cancelAgentSession: mission.cancelAgentSession.bind(mission),
            deliver: mission.deliver.bind(mission),
            generateTasksForStage: mission.generateTasksForStage.bind(mission),
            buildMissionSnapshot: mission.buildMissionSnapshot.bind(mission),
            panicStopMission: mission.panicStopMission.bind(mission),
            pauseMission: mission.pauseMission.bind(mission),
            read: mission.read.bind(mission),
            readDocument: mission.readDocument.bind(mission),
            readControlView: mission.readControlView.bind(mission),
            readTerminal: mission.readTerminal.bind(mission),
            readWorktree: mission.readWorktree.bind(mission),
            reopenTask: mission.reopenTask.bind(mission),
            restartLaunchQueue: mission.restartLaunchQueue.bind(mission),
            resumeMission: mission.resumeMission.bind(mission),
            reworkTask: mission.reworkTask.bind(mission),
            reworkTaskFromVerification: mission.reworkTaskFromVerification.bind(mission),
            sendAgentSessionCommand: mission.sendAgentSessionCommand.bind(mission),
            sendAgentSessionPrompt: mission.sendAgentSessionPrompt.bind(mission),
            sendTerminalInput: mission.sendTerminalInput.bind(mission),
            startTask: mission.startTask.bind(mission),
            setTaskAutostart: mission.setTaskAutostart.bind(mission),
            terminateAgentSession: mission.terminateAgentSession.bind(mission),
            toEntity: mission.toEntity.bind(mission),
            writeDocument: mission.writeDocument.bind(mission)
        };
    }

}

export function requireMissionRegistry(context: EntityExecutionContext): MissionRegistry {
    if (!context.missionRegistry) {
        throw new Error('Mission entity methods require a daemon-owned mission registry.');
    }
    return context.missionRegistry;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repositoryRootPath, configuredPath);
}