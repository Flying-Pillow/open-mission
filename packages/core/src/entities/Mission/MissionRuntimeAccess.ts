import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentCommand, AgentPrompt } from '../../agent/AgentRuntimeTypes.js';
import { createConfiguredAgentRunners } from '../../agent/runtimes/AgentRuntimeFactory.js';
import { readRepositorySettingsDocument } from '../../lib/daemonConfig.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { getMissionWorktreesPath } from '../../lib/repositoryPaths.js';
import { Factory } from '../../mission/Factory.js';
import type { MissionRuntime } from '../../mission/Mission.js';
import {
    missionActionListSnapshotSchema,
    missionIdentityPayloadSchema,
    missionSnapshotSchema,
    type MissionActionListSnapshot,
    type MissionDocumentSnapshot,
    type MissionIdentityPayload,
    type MissionSnapshot,
    type MissionWorktreeNodeData
} from '../../schemas/Mission.js';
import type { MissionArtifactSnapshot } from '../../schemas/Artifact.js';
import type { MissionStageSnapshot } from '../../schemas/Stage.js';
import type { MissionTaskSnapshot } from '../../schemas/Task.js';
import type {
    MissionAgentCommand,
    MissionAgentPrompt,
    MissionAgentSessionSnapshot
} from '../../schemas/AgentSession.js';
import { createDefaultRepositorySettings } from '../../schemas/RepositorySettings.js';
import { normalizeWorkflowSettings } from '../../settings/validation.js';
import type { OperatorActionDescriptor } from '../../types.js';
import { readMissionWorkflowDefinition } from '../../workflow/mission/preset.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import type { Mission as MissionEntity } from './Mission.js';

export type MissionCommandContext = {
    surfacePath: string;
    loadRuntime?: MissionRuntimeLoader;
};

export type MissionRuntimeLoader = (
    input: MissionIdentityPayload,
    context: { surfacePath: string },
    terminalSessionName?: string
) => Promise<MissionRuntimeHandle | undefined>;

export type MissionRuntimeHandle = Pick<
    MissionRuntime,
    | 'clearMissionPanic'
    | 'completeAgentSession'
    | 'completeTask'
    | 'dispose'
    | 'executeAction'
    | 'listAvailableActionsSnapshot'
    | 'cancelAgentSession'
    | 'deliver'
    | 'panicStopMission'
    | 'pauseMission'
    | 'reopenTask'
    | 'restartLaunchQueue'
    | 'resumeMission'
    | 'sendAgentSessionCommand'
    | 'sendAgentSessionPrompt'
    | 'startTask'
    | 'terminateAgentSession'
    | 'toEntity'
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

export async function loadRequiredMissionRuntime(
    input: MissionIdentityPayload,
    context: MissionCommandContext,
    terminalSessionName?: string
): Promise<MissionRuntimeHandle> {
    const payload = missionIdentityPayloadSchema.parse({
        missionId: input.missionId,
        ...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
    });
    if (!context.surfacePath.trim()) {
        throw new Error('Mission source methods require a surfacePath context.');
    }

    const runtime = await (context.loadRuntime ?? loadMissionRuntime)(payload, context, terminalSessionName);
    if (!runtime) {
        throw new Error(`Mission '${payload.missionId}' could not be resolved.`);
    }

    return runtime;
}

export async function buildMissionSnapshot(mission: MissionRuntimeHandle, missionId: string): Promise<MissionSnapshot> {
    const entity = await mission.toEntity();
    const snapshot = toMissionEntitySnapshot(entity);
    return missionSnapshotSchema.parse({
        mission: snapshot,
        status: {
            missionId: snapshot.missionId.trim() || missionId,
            ...(snapshot.title ? { title: snapshot.title } : {}),
            ...(snapshot.issueId !== undefined ? { issueId: snapshot.issueId } : {}),
            ...(snapshot.type ? { type: snapshot.type } : {}),
            ...(snapshot.operationalMode ? { operationalMode: snapshot.operationalMode } : {}),
            ...(snapshot.branchRef ? { branchRef: snapshot.branchRef } : {}),
            ...(snapshot.missionDir ? { missionDir: snapshot.missionDir } : {}),
            ...(snapshot.missionRootDir ? { missionRootDir: snapshot.missionRootDir } : {}),
            ...(snapshot.artifacts.length > 0 ? { artifacts: snapshot.artifacts } : {}),
            ...(snapshot.lifecycle || snapshot.updatedAt || snapshot.currentStageId || snapshot.stages.length > 0
                ? {
                    workflow: {
                        ...(snapshot.lifecycle ? { lifecycle: snapshot.lifecycle } : {}),
                        ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
                        ...(snapshot.currentStageId ? { currentStageId: snapshot.currentStageId } : {}),
                        ...(snapshot.stages.length > 0 ? { stages: snapshot.stages } : {})
                    }
                }
                : {}),
            ...(snapshot.recommendedAction ? { recommendedAction: snapshot.recommendedAction } : {})
        },
        ...(snapshot.lifecycle || snapshot.updatedAt || snapshot.currentStageId || snapshot.stages.length > 0
            ? {
                workflow: {
                    ...(snapshot.lifecycle ? { lifecycle: snapshot.lifecycle } : {}),
                    ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
                    ...(snapshot.currentStageId ? { currentStageId: snapshot.currentStageId } : {}),
                    ...(snapshot.stages.length > 0 ? { stages: snapshot.stages } : {})
                }
            }
            : {}),
        stages: snapshot.stages,
        tasks: snapshot.stages.flatMap((stage) => stage.tasks),
        artifacts: snapshot.artifacts,
        agentSessions: snapshot.agentSessions
    });
}

export async function buildMissionActionListSnapshot(
    mission: MissionRuntimeHandle,
    missionId: string
): Promise<MissionActionListSnapshot> {
    const snapshot = await mission.listAvailableActionsSnapshot();
    return missionActionListSnapshotSchema.parse({
        missionId,
        actions: snapshot.actions.map(toMissionActionDescriptor)
    });
}

export function toMissionActionDescriptor(action: OperatorActionDescriptor): MissionActionListSnapshot['actions'][number] {
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

export function requireStage(snapshot: MissionSnapshot, stageId: string): MissionStageSnapshot {
    const stage = snapshot.stages.find((candidate) => candidate.stageId === stageId);
    if (!stage) {
        throw new Error(`Stage '${stageId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
    }
    return stage;
}

export function requireTask(snapshot: MissionSnapshot, taskId: string): MissionTaskSnapshot {
    const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) {
        throw new Error(`Task '${taskId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
    }
    return task;
}

export function requireArtifact(snapshot: MissionSnapshot, artifactId: string): MissionArtifactSnapshot {
    const artifact = snapshot.artifacts.find((candidate) => candidate.artifactId === artifactId);
    if (!artifact) {
        throw new Error(`Artifact '${artifactId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
    }
    return artifact;
}

export function requireAgentSession(snapshot: MissionSnapshot, sessionId: string): MissionAgentSessionSnapshot {
    const session = snapshot.agentSessions.find((candidate) => candidate.sessionId === sessionId);
    if (!session) {
        throw new Error(`AgentSession '${sessionId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
    }
    return session;
}

export function requireArtifactFilePath(snapshot: MissionSnapshot, artifact: MissionArtifactSnapshot): string {
    if (artifact.filePath) {
        return artifact.filePath;
    }
    if (artifact.relativePath && snapshot.mission.missionRootDir) {
        return path.join(snapshot.mission.missionRootDir, artifact.relativePath);
    }
    throw new Error(`Artifact '${artifact.artifactId}' does not have a readable document path.`);
}

export function getTerminalSessionName(input: unknown): string | undefined {
    if (!isRecord(input) || typeof input['terminalSessionName'] !== 'string') {
        return undefined;
    }
    const terminalSessionName = input['terminalSessionName'].trim();
    return terminalSessionName.length > 0 ? terminalSessionName : undefined;
}

export function getReason(input: unknown): string | undefined {
    if (!isRecord(input) || typeof input['reason'] !== 'string') {
        return undefined;
    }
    const reason = input['reason'].trim();
    return reason.length > 0 ? reason : undefined;
}

export function normalizeAgentPrompt(input: MissionAgentPrompt): AgentPrompt {
    return {
        source: input.source,
        text: input.text,
        ...(input.title ? { title: input.title } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}

export function normalizeAgentCommand(input: MissionAgentCommand): AgentCommand {
    return {
        type: input.type,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}

export function resolveControlRoot(payload: MissionIdentityPayload, context: { surfacePath: string }): string {
    return path.resolve(payload.repositoryRootPath?.trim() || context.surfacePath);
}

export async function readMissionDocument(filePath: string): Promise<MissionDocumentSnapshot> {
    const content = await fs.readFile(filePath, 'utf8');
    const stats = await fs.stat(filePath);
    return {
        filePath,
        content,
        updatedAt: stats.mtime.toISOString()
    };
}

export async function writeMissionDocument(filePath: string, content: string): Promise<MissionDocumentSnapshot> {
    await fs.writeFile(filePath, content, 'utf8');
    return readMissionDocument(filePath);
}

export async function assertMissionDocumentPath(
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
        canonicalizeAllowedRoot(getMissionWorktreesPath(controlRoot))
    ]);

    if (!roots.some((rootPath) => rootPath && isPathInsideRoot(rootPath, canonicalPath))) {
        throw new Error(`Mission document '${normalizedPath}' is outside the active repository root.`);
    }
}

export async function readDirectoryTree(directoryPath: string, rootPath: string): Promise<MissionWorktreeNodeData[]> {
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
                        children: await readDirectoryTree(absolutePath, rootPath)
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

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function loadMissionRuntime(
    input: MissionIdentityPayload,
    context: { surfacePath: string },
    terminalSessionName?: string
): Promise<MissionRuntime | undefined> {
    const controlRoot = input.repositoryRootPath?.trim() || context.surfacePath;
    const settings = readRepositorySettingsDocument(controlRoot) ?? createDefaultRepositorySettings();
    const workflow = normalizeWorkflowSettings(
        readMissionWorkflowDefinition(controlRoot) ?? createDefaultWorkflowSettings()
    );
    const taskRunners = new Map(
        (await createConfiguredAgentRunners({
            controlRoot,
            ...(terminalSessionName?.trim() ? { terminalSessionName: terminalSessionName.trim() } : {})
        })).map((runner) => [runner.id, runner] as const)
    );

    return Factory.load(new FilesystemAdapter(controlRoot), { missionId: input.missionId }, {
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
}

function toMissionEntitySnapshot(entity: MissionEntity): MissionSnapshot['mission'] {
    return missionSnapshotSchema.shape.mission.parse(entity.toSnapshot());
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
