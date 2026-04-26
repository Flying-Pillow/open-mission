import * as path from 'node:path';
import { getMissionWorktreesPath } from '../../lib/repositoryPaths.js';
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
    missionAgentSessionCommandPayloadSchema,
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
    type MissionAgentSessionCommandPayload,
    type MissionSnapshot,
    type MissionTaskCommandPayload,
    type MissionWorktreeSnapshot,
    type MissionWriteDocumentPayload
} from '../../schemas/Mission.js';
import type { OperatorActionExecutionStep } from '../../types.js';
import {
    assertMissionDocumentPath,
    buildMissionActionListSnapshot,
    buildMissionSnapshot,
    loadRequiredMissionRuntime,
    normalizeAgentCommand,
    normalizeAgentPrompt,
    readDirectoryTree,
    readMissionDocument,
    resolveControlRoot,
    writeMissionDocument,
    type MissionCommandContext
} from './MissionRuntimeAccess.js';

export type { MissionCommandContext, MissionRuntimeHandle, MissionRuntimeLoader } from './MissionRuntimeAccess.js';

export class MissionCommands {
    public static async read(
        input: MissionIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionSnapshot> {
        const payload = missionIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context, terminalSessionName);
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
        input: MissionAgentSessionCommandPayload,
        context: MissionCommandContext
    ): Promise<MissionCommandAcknowledgement> {
        const payload = missionAgentSessionCommandPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
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
        const mission = await loadRequiredMissionRuntime(payload, context, payload.terminalSessionName);
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
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            await assertMissionDocumentPath(payload.path, 'write', resolveControlRoot(payload, context));
            return missionDocumentSnapshotSchema.parse(await writeMissionDocument(payload.path, payload.content));
        } finally {
            mission.dispose();
        }
    }

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
