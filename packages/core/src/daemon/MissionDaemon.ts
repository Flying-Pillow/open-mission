import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentCommand, AgentPrompt } from './runtime/agent/AgentRuntimeTypes.js';
import { createConfiguredAgentRunners } from './runtime/agent/runtimes/AgentRuntimeFactory.js';
import type { EntityExecutionContext } from '../entities/Entity/Entity.js';
import type { EntityCommandDescriptorType } from '../entities/Entity/EntitySchema.js';
import type {
    AgentSessionCommand,
    AgentSessionPrompt,
    AgentSessionSnapshot
} from '../entities/AgentSession/AgentSessionSchema.js';
import type { MissionArtifactSnapshot } from '../entities/Artifact/ArtifactSchema.js';
import {
    missionActionListSnapshotSchema,
    missionIdentityPayloadSchema,
    missionSnapshotSchema,
    type MissionActionListSnapshot,
    type MissionDocumentSnapshot,
    type MissionIdentityPayload,
    type MissionSnapshot,
    type MissionWorktreeNodeData
} from '../entities/Mission/MissionSchema.js';
import { Mission } from '../entities/Mission/Mission.js';
import type { MissionStageSnapshot } from '../entities/Stage/StageSchema.js';
import type { MissionTaskSnapshot } from '../entities/Task/TaskSchema.js';
import { Repository } from '../entities/Repository/Repository.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { normalizeWorkflowSettings } from '../settings/validation.js';
import type { OperatorActionDescriptor } from '../types.js';
import { readMissionWorkflowDefinition } from '../workflow/mission/preset.js';

export type MissionLoader = (
    input: MissionIdentityPayload,
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
    | 'executeAction'
    | 'executeOperatorAction'
    | 'ensureTerminal'
    | 'listAvailableActionsSnapshot'
    | 'listActions'
    | 'cancelAgentSession'
    | 'deliver'
    | 'panicStopMission'
    | 'pauseMission'
    | 'read'
    | 'readDocument'
    | 'readProjection'
    | 'readTerminal'
    | 'readWorktree'
    | 'reopenTask'
    | 'restartLaunchQueue'
    | 'resumeMission'
    | 'sendAgentSessionCommand'
    | 'sendAgentSessionPrompt'
    | 'sendTerminalInput'
    | 'startTask'
    | 'sessionCommand'
    | 'taskCommand'
    | 'terminateAgentSession'
    | 'toEntity'
    | 'writeDocument'
>;

export const IGNORED_WORKTREE_ENTRY_NAMES = new Set([
    '.git',
    'node_modules',
    '.pnpm-store',
    '.svelte-kit',
    '.turbo',
    'dist',
    'build'
]);

export class MissionDaemon {
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
        for (const snapshot of await Repository.find({}, context)) {
            roots.add(path.resolve(snapshot.repository.repositoryRootPath));
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
                    await this.loadMissionFromRegistry(
                        { missionId: mission.descriptor.missionId },
                        { surfacePath: controlRoot }
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
        input: MissionIdentityPayload,
        context: { surfacePath: string },
        terminalSessionName?: string
    ): Promise<MissionHandle> {
        const payload = missionIdentityPayloadSchema.parse({
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

    public async buildMissionSnapshot(mission: MissionHandle, missionId: string): Promise<MissionSnapshot> {
        const entity = await mission.toEntity();
        const snapshot = this.toMissionEntitySnapshot(entity);
        const actions = (await mission.listAvailableActionsSnapshot()).actions;
        const commandSnapshot = this.withEntityCommands(snapshot, actions);
        return missionSnapshotSchema.parse({
            mission: commandSnapshot,
            status: {
                missionId: commandSnapshot.missionId.trim() || missionId,
                ...(commandSnapshot.title ? { title: commandSnapshot.title } : {}),
                ...(commandSnapshot.issueId !== undefined ? { issueId: commandSnapshot.issueId } : {}),
                ...(commandSnapshot.type ? { type: commandSnapshot.type } : {}),
                ...(commandSnapshot.operationalMode ? { operationalMode: commandSnapshot.operationalMode } : {}),
                ...(commandSnapshot.branchRef ? { branchRef: commandSnapshot.branchRef } : {}),
                ...(commandSnapshot.missionDir ? { missionDir: commandSnapshot.missionDir } : {}),
                ...(commandSnapshot.missionRootDir ? { missionRootDir: commandSnapshot.missionRootDir } : {}),
                ...(commandSnapshot.artifacts.length > 0 ? { artifacts: commandSnapshot.artifacts } : {}),
                ...(commandSnapshot.lifecycle || commandSnapshot.updatedAt || commandSnapshot.currentStageId || commandSnapshot.stages.length > 0
                    ? {
                        workflow: {
                            ...(commandSnapshot.lifecycle ? { lifecycle: commandSnapshot.lifecycle } : {}),
                            ...(commandSnapshot.updatedAt ? { updatedAt: commandSnapshot.updatedAt } : {}),
                            ...(commandSnapshot.currentStageId ? { currentStageId: commandSnapshot.currentStageId } : {}),
                            ...(commandSnapshot.stages.length > 0 ? { stages: commandSnapshot.stages } : {})
                        }
                    }
                    : {}),
                ...(commandSnapshot.recommendedAction ? { recommendedAction: commandSnapshot.recommendedAction } : {})
            },
            ...(commandSnapshot.lifecycle || commandSnapshot.updatedAt || commandSnapshot.currentStageId || commandSnapshot.stages.length > 0
                ? {
                    workflow: {
                        ...(commandSnapshot.lifecycle ? { lifecycle: commandSnapshot.lifecycle } : {}),
                        ...(commandSnapshot.updatedAt ? { updatedAt: commandSnapshot.updatedAt } : {}),
                        ...(commandSnapshot.currentStageId ? { currentStageId: commandSnapshot.currentStageId } : {}),
                        ...(commandSnapshot.stages.length > 0 ? { stages: commandSnapshot.stages } : {})
                    }
                }
                : {}),
            stages: commandSnapshot.stages,
            tasks: commandSnapshot.stages.flatMap((stage) => stage.tasks),
            artifacts: commandSnapshot.artifacts,
            agentSessions: commandSnapshot.agentSessions
        });
    }

    public async buildMissionActionListSnapshot(
        mission: MissionHandle,
        missionId: string
    ): Promise<MissionActionListSnapshot> {
        const snapshot = await mission.listAvailableActionsSnapshot();
        return missionActionListSnapshotSchema.parse({
            missionId,
            actions: snapshot.actions.map(this.toMissionActionDescriptor)
        });
    }

    public toMissionActionDescriptor(action: OperatorActionDescriptor): MissionActionListSnapshot['actions'][number] {
        return {
            actionId: action.id,
            label: action.label,
            ...(action.reason ? { description: action.reason } : {}),
            kind: action.scope,
            target: {
                scope: action.scope,
                ...(action.targetId ? { targetId: action.targetId } : {})
            },
            disabled: action.disabled,
            ...(action.disabledReason ? { disabledReason: action.disabledReason } : {})
        };
    }

    public requireStage(snapshot: MissionSnapshot, stageId: string): MissionStageSnapshot {
        const stage = snapshot.stages.find((candidate) => candidate.stageId === stageId);
        if (!stage) {
            throw new Error(`Stage '${stageId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
        }
        return stage;
    }

    public requireTask(snapshot: MissionSnapshot, taskId: string): MissionTaskSnapshot {
        const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
        if (!task) {
            throw new Error(`Task '${taskId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
        }
        return task;
    }

    public requireArtifact(snapshot: MissionSnapshot, artifactId: string): MissionArtifactSnapshot {
        const artifact = snapshot.artifacts.find((candidate) => candidate.artifactId === artifactId);
        if (!artifact) {
            throw new Error(`Artifact '${artifactId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
        }
        return artifact;
    }

    public requireAgentSession(snapshot: MissionSnapshot, sessionId: string): AgentSessionSnapshot {
        const session = snapshot.agentSessions.find((candidate) => candidate.sessionId === sessionId);
        if (!session) {
            throw new Error(`AgentSession '${sessionId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
        }
        return session;
    }

    public requireArtifactFilePath(snapshot: MissionSnapshot, artifact: MissionArtifactSnapshot): string {
        if (artifact.filePath) {
            return artifact.filePath;
        }
        if (artifact.relativePath && snapshot.mission.missionRootDir) {
            return path.join(snapshot.mission.missionRootDir, artifact.relativePath);
        }
        throw new Error(`Artifact '${artifact.artifactId}' does not have a readable document path.`);
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

    public normalizeAgentPrompt(input: AgentSessionPrompt): AgentPrompt {
        return {
            source: input.source,
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {})
        };
    }

    public normalizeAgentCommand(input: AgentSessionCommand): AgentCommand {
        return {
            type: input.type,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {})
        };
    }

    public resolveControlRoot(payload: MissionIdentityPayload, context: { surfacePath: string }): string {
        return path.resolve(payload.repositoryRootPath?.trim() || context.surfacePath);
    }

    public async readMissionDocument(filePath: string): Promise<MissionDocumentSnapshot> {
        const content = await fs.readFile(filePath, 'utf8');
        const stats = await fs.stat(filePath);
        return {
            filePath,
            content,
            updatedAt: stats.mtime.toISOString()
        };
    }

    public async writeMissionDocument(filePath: string, content: string): Promise<MissionDocumentSnapshot> {
        await fs.writeFile(filePath, content, 'utf8');
        return this.readMissionDocument(filePath);
    }

    public async assertMissionDocumentPath(
        filePath: string,
        intent: 'read' | 'write',
        controlRoot: string
    ): Promise<void> {
        const normalizedPath = filePath.trim();
        if (!normalizedPath) {
            throw new Error('Mission document path must not be empty.');
        }

        const candidatePath = path.resolve(normalizedPath);
        const canonicalPath = await resolveCanonicalDocumentPath(candidatePath, intent);
        const roots = await Promise.all([
            canonicalizeAllowedRoot(controlRoot),
            canonicalizeAllowedRoot(Repository.getMissionWorktreesPath(controlRoot))
        ]);

        if (!roots.some((rootPath) => rootPath && isPathInsideRoot(rootPath, canonicalPath))) {
            throw new Error(`Mission document '${normalizedPath}' is outside the active repository root.`);
        }
    }

    public async readDirectoryTree(directoryPath: string, rootPath: string): Promise<MissionWorktreeNodeData[]> {
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });
        const nodes = await Promise.all(
            entries
                .filter((entry) => !IGNORED_WORKTREE_ENTRY_NAMES.has(entry.name))
                .map(async (entry) => {
                    const absolutePath = path.join(directoryPath, entry.name);
                    const relativePath = path.relative(rootPath, absolutePath) || entry.name;
                    if (entry.isDirectory()) {
                        return {
                            name: entry.name,
                            relativePath,
                            absolutePath,
                            kind: 'directory' as const,
                            children: await this.readDirectoryTree(absolutePath, rootPath)
                        };
                    }

                    return {
                        name: entry.name,
                        relativePath,
                        absolutePath,
                        kind: 'file' as const
                    };
                })
        );

        return nodes.sort(compareMissionWorktreeNodes);
    }

    private async loadMissionFromRegistry(
        input: MissionIdentityPayload,
        context: { surfacePath: string },
        terminalSessionName?: string
    ): Promise<MissionHandle | undefined> {
        const controlRoot = this.resolveControlRoot(input, context);
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
        input: MissionIdentityPayload,
        context: { surfacePath: string },
    ): Promise<Mission | undefined> => {
        const controlRoot = input.repositoryRootPath?.trim() || context.surfacePath;
        const settings = Repository.requireSettingsDocument(controlRoot);
        const workflowDocument = readMissionWorkflowDefinition(controlRoot);
        if (!workflowDocument) {
            throw new Error(`Repository workflow definition '${Repository.getMissionWorkflowDefinitionPath(controlRoot)}' is required.`);
        }
        const workflow = normalizeWorkflowSettings(
            workflowDocument
        );
        const taskRunners = new Map(
            (await createConfiguredAgentRunners({
                controlRoot
            })).map((runner) => [runner.id, runner] as const)
        );

        return Mission.load(new FilesystemAdapter(controlRoot), { missionId: input.missionId }, {
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
    };

    private toMissionEntitySnapshot(entity: Mission): MissionSnapshot['mission'] {
        return missionSnapshotSchema.shape.mission.parse(entity.toData());
    }

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
            executeAction: mission.executeAction.bind(mission),
            executeOperatorAction: mission.executeOperatorAction.bind(mission),
            ensureTerminal: mission.ensureTerminal.bind(mission),
            listAvailableActionsSnapshot: mission.listAvailableActionsSnapshot.bind(mission),
            listActions: mission.listActions.bind(mission),
            cancelAgentSession: mission.cancelAgentSession.bind(mission),
            deliver: mission.deliver.bind(mission),
            panicStopMission: mission.panicStopMission.bind(mission),
            pauseMission: mission.pauseMission.bind(mission),
            read: mission.read.bind(mission),
            readDocument: mission.readDocument.bind(mission),
            readProjection: mission.readProjection.bind(mission),
            readTerminal: mission.readTerminal.bind(mission),
            readWorktree: mission.readWorktree.bind(mission),
            reopenTask: mission.reopenTask.bind(mission),
            restartLaunchQueue: mission.restartLaunchQueue.bind(mission),
            resumeMission: mission.resumeMission.bind(mission),
            sendAgentSessionCommand: mission.sendAgentSessionCommand.bind(mission),
            sendAgentSessionPrompt: mission.sendAgentSessionPrompt.bind(mission),
            sendTerminalInput: mission.sendTerminalInput.bind(mission),
            startTask: mission.startTask.bind(mission),
            sessionCommand: mission.sessionCommand.bind(mission),
            taskCommand: mission.taskCommand.bind(mission),
            terminateAgentSession: mission.terminateAgentSession.bind(mission),
            toEntity: mission.toEntity.bind(mission),
            writeDocument: mission.writeDocument.bind(mission)
        };
    }

    private withEntityCommands(
        snapshot: MissionSnapshot['mission'],
        actions: OperatorActionDescriptor[]
    ): MissionSnapshot['mission'] {
        return {
            ...snapshot,
            commands: toEntityCommandDescriptors(actions, missionCommandMappings()),
            artifacts: snapshot.artifacts.map((artifact) => ({
                ...artifact,
                commands: []
            })),
            stages: snapshot.stages.map((stage) => ({
                ...stage,
                commands: toEntityCommandDescriptors(actions, [{
                    actionId: `generation.tasks.${stage.stageId}`,
                    commandId: 'stage.generateTasks'
                }]),
                artifacts: stage.artifacts.map((artifact) => ({
                    ...artifact,
                    commands: []
                })),
                tasks: stage.tasks.map((task) => ({
                    ...task,
                    commands: toEntityCommandDescriptors(actions, taskCommandMappings(task.taskId))
                }))
            })),
            agentSessions: (snapshot.agentSessions ?? []).map((session) => ({
                ...session,
                commands: toEntityCommandDescriptors(actions, agentSessionCommandMappings(session.sessionId))
            }))
        };
    }
}

export function requireMissionDaemon(context: EntityExecutionContext): MissionDaemon {
    if (!context.missionDaemon) {
        throw new Error('Mission entity methods require a daemon-owned mission service.');
    }
    return context.missionDaemon;
}

type EntityActionCommandMapping = {
    actionId: string;
    commandId: string;
};

function missionCommandMappings(): EntityActionCommandMapping[] {
    return [
        { actionId: 'mission.pause', commandId: 'mission.pause' },
        { actionId: 'mission.resume', commandId: 'mission.resume' },
        { actionId: 'mission.panic', commandId: 'mission.panic' },
        { actionId: 'mission.clear-panic', commandId: 'mission.clearPanic' },
        { actionId: 'mission.restart-queue', commandId: 'mission.restartQueue' },
        { actionId: 'mission.deliver', commandId: 'mission.deliver' }
    ];
}

function taskCommandMappings(taskId: string): EntityActionCommandMapping[] {
    return [
        { actionId: `task.start.${taskId}`, commandId: 'task.start' },
        { actionId: `task.done.${taskId}`, commandId: 'task.complete' },
        { actionId: `task.reopen.${taskId}`, commandId: 'task.reopen' }
    ];
}

function agentSessionCommandMappings(sessionId: string): EntityActionCommandMapping[] {
    return [
        { actionId: `session.cancel.${sessionId}`, commandId: 'agentSession.cancel' },
        { actionId: `session.terminate.${sessionId}`, commandId: 'agentSession.terminate' }
    ];
}

function toEntityCommandDescriptors(
    actions: OperatorActionDescriptor[],
    mappings: EntityActionCommandMapping[]
): EntityCommandDescriptorType[] {
    return mappings.flatMap((mapping) => {
        const action = actions.find((candidate) => candidate.id === mapping.actionId);
        if (!action) {
            return [];
        }

        return [{
            commandId: mapping.commandId,
            label: action.label,
            ...(action.reason ? { description: action.reason } : {}),
            disabled: action.disabled,
            ...(action.disabledReason ? { disabledReason: action.disabledReason } : {}),
            ...(action.ui?.requiresConfirmation
                ? {
                    confirmation: {
                        required: true,
                        ...(action.ui.confirmationPrompt ? { prompt: action.ui.confirmationPrompt } : {})
                    }
                }
                : {})
        }];
    });
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repositoryRootPath, configuredPath);
}

async function canonicalizeAllowedRoot(rootPath: string): Promise<string | undefined> {
    try {
        return await fs.realpath(rootPath);
    } catch (error) {
        if (isMissingFileError(error)) {
            return rootPath;
        }

        throw error;
    }
}

async function resolveCanonicalDocumentPath(
    candidatePath: string,
    intent: 'read' | 'write'
): Promise<string> {
    try {
        return await fs.realpath(candidatePath);
    } catch (error) {
        if (!isMissingFileError(error) || intent === 'read') {
            throw error;
        }

        const parentDirectory = await fs.realpath(path.dirname(candidatePath));
        return path.join(parentDirectory, path.basename(candidatePath));
    }
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
    const relativePath = path.relative(rootPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function compareMissionWorktreeNodes(left: MissionWorktreeNodeData, right: MissionWorktreeNodeData): number {
    if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { numeric: true });
}