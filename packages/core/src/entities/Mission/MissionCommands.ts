import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentCommand, AgentPrompt } from '../../agent/AgentRuntimeTypes.js';
import { createConfiguredAgentRunners } from '../../agent/runtimes/AgentRuntimeFactory.js';
import { readRepositorySettingsDocument } from '../../lib/daemonConfig.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { getMissionWorktreesPath } from '../../lib/repositoryPaths.js';
import { Factory } from '../../mission/Factory.js';
import type { MissionRuntime } from '../../mission/Mission.js';
import { createDefaultRepositorySettings } from '../../schemas/RepositorySettings.js';
import {
    missionActionListSnapshotSchema,
    missionCommandAcknowledgementSchema,
    missionCommandPayloadSchema,
    missionDocumentSnapshotSchema,
    missionExecuteActionPayloadSchema,
    missionIdentityPayloadSchema,
    missionListActionsPayloadSchema,
    missionReadDocumentPayloadSchema,
    missionReadProjectionPayloadSchema,
    missionReadWorktreePayloadSchema,
    missionProjectionSnapshotSchema,
    missionSessionCommandPayloadSchema,
    missionSnapshotSchema,
    missionTaskCommandPayloadSchema,
    missionWorktreeSnapshotSchema,
    missionWriteDocumentPayloadSchema,
    type MissionActionListSnapshot,
    type MissionCommandAcknowledgement,
    type MissionCommandPayload,
    type MissionDocumentSnapshot,
    type MissionExecuteActionPayload,
    type MissionIdentityPayload,
    type MissionListActionsPayload,
    type MissionReadDocumentPayload,
    type MissionReadProjectionPayload,
    type MissionReadWorktreePayload,
    type MissionProjectionSnapshot,
    type MissionSessionCommandPayload,
    type MissionSnapshot,
    type MissionTaskCommandPayload,
    type MissionWorktreeNodeData,
    type MissionWorktreeSnapshot,
    type MissionWriteDocumentPayload
} from '../../schemas/Mission.js';
import { normalizeWorkflowSettings } from '../../settings/validation.js';
import type { OperatorActionDescriptor, OperatorActionExecutionStep } from '../../types.js';
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

export class MissionCommands {
    public static async read(
        input: MissionIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionSnapshot> {
        const payload = missionIdentityPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            return missionSnapshotSchema.parse(await buildMissionSnapshot(mission, payload.missionId));
        } finally {
            mission.dispose();
        }
    }

    public static async readProjection(
        input: MissionReadProjectionPayload,
        context: MissionCommandContext
    ): Promise<MissionProjectionSnapshot> {
        const payload = missionReadProjectionPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            return missionProjectionSnapshotSchema.parse({
                missionId: snapshot.mission.missionId,
                ...(snapshot.status ? { status: snapshot.status } : {}),
                ...(snapshot.workflow ? { workflow: snapshot.workflow } : {}),
                actions: await buildMissionActionListSnapshot(mission, payload.missionId),
                updatedAt: snapshot.mission.updatedAt
            });
        } finally {
            mission.dispose();
        }
    }

    public static async listActions(
        input: MissionListActionsPayload,
        context: MissionCommandContext
    ): Promise<MissionActionListSnapshot> {
        const payload = missionListActionsPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            return missionActionListSnapshotSchema.parse({
                ...(await buildMissionActionListSnapshot(mission, payload.missionId)),
                ...(payload.context ? { context: payload.context } : {})
            });
        } finally {
            mission.dispose();
        }
    }

    public static async readDocument(
        input: MissionReadDocumentPayload,
        context: MissionCommandContext
    ): Promise<MissionDocumentSnapshot> {
        const payload = missionReadDocumentPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            await assertMissionDocumentPath(payload.path, 'read', resolveControlRoot(payload, context));
            return missionDocumentSnapshotSchema.parse(await readMissionDocument(payload.path));
        } finally {
            mission.dispose();
        }
    }

    public static async readWorktree(
        input: MissionReadWorktreePayload,
        context: MissionCommandContext
    ): Promise<MissionWorktreeSnapshot> {
        const payload = missionReadWorktreePayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            const rootPath = path.join(getMissionWorktreesPath(resolveControlRoot(payload, context)), payload.missionId);
            return missionWorktreeSnapshotSchema.parse({
                rootPath,
                fetchedAt: new Date().toISOString(),
                tree: await readDirectoryTree(rootPath, rootPath)
            });
        } finally {
            mission.dispose();
        }
    }

    public static async command(
        input: MissionCommandPayload,
        context: MissionCommandContext
    ): Promise<MissionCommandAcknowledgement> {
        const payload = missionCommandPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            switch (payload.command.action) {
                case 'pause':
                    await mission.pauseMission();
                    break;
                case 'resume':
                    await mission.resumeMission();
                    break;
                case 'panic':
                    await mission.panicStopMission();
                    break;
                case 'clearPanic':
                    await mission.clearMissionPanic();
                    break;
                case 'restartQueue':
                    await mission.restartLaunchQueue();
                    break;
                case 'deliver':
                    await mission.deliver();
                    break;
            }

            return buildCommandAcknowledgement(payload, 'command');
        } finally {
            mission.dispose();
        }
    }

    public static async taskCommand(
        input: MissionTaskCommandPayload,
        context: MissionCommandContext
    ): Promise<MissionCommandAcknowledgement> {
        const payload = missionTaskCommandPayloadSchema.parse(input);
        const terminalSessionName = payload.command.action === 'start'
            ? payload.command.terminalSessionName
            : undefined;
        const mission = await MissionCommands.loadRequiredRuntime(payload, context, terminalSessionName);
        try {
            switch (payload.command.action) {
                case 'start':
                    await mission.startTask(
                        payload.taskId,
                        payload.command.terminalSessionName?.trim()
                            ? { terminalSessionName: payload.command.terminalSessionName.trim() }
                            : {}
                    );
                    break;
                case 'complete':
                    await mission.completeTask(payload.taskId);
                    break;
                case 'reopen':
                    await mission.reopenTask(payload.taskId);
                    break;
            }

            return buildCommandAcknowledgement(payload, 'taskCommand', { taskId: payload.taskId });
        } finally {
            mission.dispose();
        }
    }

    public static async sessionCommand(
        input: MissionSessionCommandPayload,
        context: MissionCommandContext
    ): Promise<MissionCommandAcknowledgement> {
        const payload = missionSessionCommandPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            switch (payload.command.action) {
                case 'complete':
                    await mission.completeAgentSession(payload.sessionId);
                    break;
                case 'cancel':
                    await mission.cancelAgentSession(payload.sessionId, payload.command.reason);
                    break;
                case 'terminate':
                    await mission.terminateAgentSession(payload.sessionId, payload.command.reason);
                    break;
                case 'prompt':
                    await mission.sendAgentSessionPrompt(payload.sessionId, normalizeAgentPrompt(payload.command.prompt));
                    break;
                case 'command':
                    await mission.sendAgentSessionCommand(payload.sessionId, normalizeAgentCommand(payload.command.command));
                    break;
            }

            return buildCommandAcknowledgement(payload, 'sessionCommand', { sessionId: payload.sessionId });
        } finally {
            mission.dispose();
        }
    }

    public static async executeAction(
        input: MissionExecuteActionPayload,
        context: MissionCommandContext
    ): Promise<MissionCommandAcknowledgement> {
        const payload = missionExecuteActionPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context, payload.terminalSessionName);
        try {
            await mission.executeAction(
                payload.actionId,
                (payload.steps ?? []) as OperatorActionExecutionStep[],
                payload.terminalSessionName?.trim()
                    ? { terminalSessionName: payload.terminalSessionName.trim() }
                    : {}
            );

            return buildCommandAcknowledgement(payload, 'executeAction', { actionId: payload.actionId });
        } finally {
            mission.dispose();
        }
    }

    public static async writeDocument(
        input: MissionWriteDocumentPayload,
        context: MissionCommandContext
    ): Promise<MissionDocumentSnapshot> {
        const payload = missionWriteDocumentPayloadSchema.parse(input);
        const mission = await MissionCommands.loadRequiredRuntime(payload, context);
        try {
            await assertMissionDocumentPath(payload.path, 'write', resolveControlRoot(payload, context));
            return missionDocumentSnapshotSchema.parse(await writeMissionDocument(payload.path, payload.content));
        } finally {
            mission.dispose();
        }
    }

    private static async loadRequiredRuntime(
        input: MissionIdentityPayload,
        context: MissionCommandContext,
        terminalSessionName?: string
    ): Promise<MissionRuntimeHandle> {
        if (!context.surfacePath.trim()) {
            throw new Error('Mission source methods require a surfacePath context.');
        }

        const runtime = await (context.loadRuntime ?? loadMissionRuntime)(input, context, terminalSessionName);
        if (!runtime) {
            throw new Error(`Mission '${input.missionId}' could not be resolved.`);
        }

        return runtime;
    }
}

const IGNORED_WORKTREE_ENTRY_NAMES = new Set([
    '.git',
    'node_modules',
    '.svelte-kit',
    '.turbo',
    'dist',
    'build'
]);

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

async function buildMissionSnapshot(mission: MissionRuntimeHandle, missionId: string): Promise<MissionSnapshot> {
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

async function buildMissionActionListSnapshot(
    mission: MissionRuntimeHandle,
    missionId: string
): Promise<MissionActionListSnapshot> {
    const snapshot = await mission.listAvailableActionsSnapshot();
    return missionActionListSnapshotSchema.parse({
        missionId,
        actions: snapshot.actions.map(toMissionActionDescriptor)
    });
}

function toMissionActionDescriptor(action: OperatorActionDescriptor): MissionActionListSnapshot['actions'][number] {
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

function toMissionEntitySnapshot(entity: MissionEntity): MissionSnapshot['mission'] {
    return missionSnapshotSchema.shape.mission.parse(entity.toSnapshot());
}

function buildCommandAcknowledgement(
    payload: MissionIdentityPayload,
    method: MissionCommandAcknowledgement['method'],
    identifiers: {
        taskId?: string;
        sessionId?: string;
        actionId?: string;
    } = {}
): MissionCommandAcknowledgement {
    return missionCommandAcknowledgementSchema.parse({
        ok: true,
        entity: 'Mission',
        method,
        id: payload.missionId,
        missionId: payload.missionId,
        ...identifiers
    });
}

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repositoryRootPath, configuredPath);
}

function resolveControlRoot(payload: MissionIdentityPayload, context: { surfacePath: string }): string {
    return path.resolve(payload.repositoryRootPath?.trim() || context.surfacePath);
}

async function readMissionDocument(filePath: string): Promise<MissionDocumentSnapshot> {
    const content = await fs.readFile(filePath, 'utf8');
    const stats = await fs.stat(filePath);
    return {
        filePath,
        content,
        updatedAt: stats.mtime.toISOString()
    };
}

async function writeMissionDocument(filePath: string, content: string): Promise<MissionDocumentSnapshot> {
    await fs.writeFile(filePath, content, 'utf8');
    return readMissionDocument(filePath);
}

async function assertMissionDocumentPath(
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

async function readDirectoryTree(directoryPath: string, rootPath: string): Promise<MissionWorktreeNodeData[]> {
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

function compareMissionWorktreeNodes(left: MissionWorktreeNodeData, right: MissionWorktreeNodeData): number {
    if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { numeric: true });
}

function normalizeAgentPrompt(input: Extract<MissionSessionCommandPayload['command'], { action: 'prompt' }>['prompt']): AgentPrompt {
    return {
        source: input.source,
        text: input.text,
        ...(input.title ? { title: input.title } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}

function normalizeAgentCommand(input: Extract<MissionSessionCommandPayload['command'], { action: 'command' }>['command']): AgentCommand {
    return {
        type: input.type,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}
