// /apps/airport/web/src/lib/client/runtime/transport/MissionCommandTransport.ts: Snapshot-and-command transport for mission task and session operations.
import type {
    AgentCommand as AgentCommand,
    AgentPrompt as AgentPrompt,
    MissionRuntimeSnapshot,
    OperatorActionExecutionStep,
    OperatorActionListSnapshot,
    OperatorActionQueryContext,
    OperatorStatus
} from '@flying-pillow/mission-core/schemas';
import type {
    EntityCommandInvocation,
    EntityRemoteResult
} from '@flying-pillow/mission-core/schemas';
import type {
    MissionCommandGateway,
    MissionDocumentPayload
} from '$lib/components/entities/Mission/Mission.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    parseMissionCommandPayload,
    parseMissionRuntimeSnapshot,
    parseMissionSessionCommandPayload,
    parseMissionTaskCommandPayload
} from '$lib/client/runtime/parsers';
import {
    operatorStatusSchema,
    missionControlSnapshotSchema,
    type MissionControlSnapshot
} from '$lib/types/mission-control';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';

type EntityCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;
const missionEntityName = 'Mission';

export class MissionCommandTransport implements MissionCommandGateway {
    private readonly fetcher: typeof fetch;
    private readonly repositoryRootPath?: string;
    private readonly commandRemote: EntityCommandExecutor;

    public constructor(input: {
        fetch?: typeof fetch;
        repositoryRootPath?: string;
        commandRemote?: EntityCommandExecutor;
    } = {}) {
        this.fetcher = input.fetch ?? fetch;
        this.repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
        this.commandRemote = input.commandRemote ?? cmd;
    }

    public startTask(input: {
        missionId: string;
        taskId: string;
        terminalSessionName?: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendTaskCommand(input.missionId, input.taskId, {
            action: 'start',
            ...(input.terminalSessionName?.trim()
                ? { terminalSessionName: input.terminalSessionName.trim() }
                : {})
        });
    }

    public completeTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendTaskCommand(input.missionId, input.taskId, {
            action: 'complete'
        });
    }

    public reopenTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendTaskCommand(input.missionId, input.taskId, {
            action: 'reopen'
        });
    }

    public pauseMission(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'pause' });
    }

    public resumeMission(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'resume' });
    }

    public panicMission(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'panic' });
    }

    public clearMissionPanic(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'clearPanic' });
    }

    public restartMissionQueue(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'restartQueue' });
    }

    public deliverMission(input: { missionId: string }): Promise<MissionRuntimeSnapshot> {
        return this.sendMissionCommand(input.missionId, { action: 'deliver' });
    }

    public completeSession(input: {
        missionId: string;
        sessionId: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendSessionRequest(input.missionId, input.sessionId, {
            action: 'complete'
        });
    }

    public cancelSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendSessionRequest(input.missionId, input.sessionId, {
            action: 'cancel',
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
        });
    }

    public terminateSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendSessionRequest(input.missionId, input.sessionId, {
            action: 'terminate',
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
        });
    }

    public sendSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendSessionRequest(input.missionId, input.sessionId, {
            action: 'prompt',
            prompt: input.prompt
        });
    }

    public sendSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
    }): Promise<MissionRuntimeSnapshot> {
        return this.sendSessionRequest(input.missionId, input.sessionId, {
            action: 'command',
            command: input.command
        });
    }

    public async getMissionControl(input: {
        missionId: string;
    }): Promise<MissionControlSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission control queries require a missionId.');
        }

        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/control${this.buildQuerySuffix()}`,
            {
                headers: {
                    accept: 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Mission control refresh failed for '${normalizedMissionId}' (${response.status}).`);
        }

        return missionControlSnapshotSchema.parse(await response.json());
    }

    public async getMissionActions(input: {
        missionId: string;
        context?: OperatorActionQueryContext;
    }): Promise<OperatorActionListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission action queries require a missionId.');
        }

        const response = await this.fetcher(
            this.buildActionsUrl(normalizedMissionId, input.context),
            {
                headers: {
                    accept: 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Mission action list failed for '${normalizedMissionId}' (${response.status}).`);
        }

        return (await response.json()) as OperatorActionListSnapshot;
    }

    public async executeMissionAction(input: {
        missionId: string;
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<OperatorStatus> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedActionId = input.actionId.trim();
        if (!normalizedMissionId || !normalizedActionId) {
            throw new Error('Mission action commands require missionId and actionId.');
        }

        return operatorStatusSchema.parse(await this.commandRemote({
            entity: missionEntityName,
            method: 'executeAction',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                actionId: normalizedActionId,
                ...(input.steps ? { steps: input.steps } : {}),
                ...(input.terminalSessionName?.trim()
                    ? { terminalSessionName: input.terminalSessionName.trim() }
                    : {})
            }
        }));
    }

    public async readMissionDocument(input: {
        missionId: string;
        path: string;
    }): Promise<MissionDocumentPayload> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedPath = input.path.trim();
        if (!normalizedMissionId || !normalizedPath) {
            throw new Error('Mission document queries require missionId and path.');
        }

        const response = await this.fetcher(
            this.buildDocumentsUrl(normalizedMissionId, normalizedPath),
            {
                headers: {
                    accept: 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Artifact load failed (${response.status}).`);
        }

        return (await response.json()) as MissionDocumentPayload;
    }

    public async writeMissionDocument(input: {
        missionId: string;
        path: string;
        content: string;
    }): Promise<MissionDocumentPayload> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedPath = input.path.trim();
        if (!normalizedMissionId || !normalizedPath) {
            throw new Error('Mission document commands require missionId and path.');
        }

        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/documents`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    path: normalizedPath,
                    ...(this.repositoryRootPath
                        ? { repositoryRootPath: this.repositoryRootPath }
                        : {}),
                    content: input.content
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Artifact save failed (${response.status}).`);
        }

        return (await response.json()) as MissionDocumentPayload;
    }

    public async getMissionWorktree(input: {
        missionId: string;
    }): Promise<MissionFileTreeResponse> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission worktree queries require a missionId.');
        }

        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/worktree${this.buildQuerySuffix()}`,
            {
                headers: {
                    accept: 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Mission worktree load failed for '${normalizedMissionId}' (${response.status}).`);
        }

        return (await response.json()) as MissionFileTreeResponse;
    }

    private async sendTaskCommand(
        missionId: string,
        taskId: string,
        body: {
            action: 'start' | 'complete' | 'reopen';
            terminalSessionName?: string;
        }
    ): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = missionId.trim();
        const normalizedTaskId = taskId.trim();
        if (!normalizedMissionId || !normalizedTaskId) {
            throw new Error('Mission task commands require missionId and taskId.');
        }

        const payload = parseMissionTaskCommandPayload(body);

        return parseMissionRuntimeSnapshot(await this.commandRemote({
            entity: missionEntityName,
            method: 'taskCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                taskId: normalizedTaskId,
                command: payload
            }
        }));
    }

    private async sendMissionCommand(
        missionId: string,
        body: {
            action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
        }
    ): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission commands require a missionId.');
        }

        const payload = parseMissionCommandPayload(body);

        return parseMissionRuntimeSnapshot(await this.commandRemote({
            entity: missionEntityName,
            method: 'command',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                command: payload
            }
        }));
    }

    private buildActionsUrl(
        missionId: string,
        context?: OperatorActionQueryContext
    ): string {
        const query = new URLSearchParams();
        if (this.repositoryRootPath) {
            query.set('repositoryRootPath', this.repositoryRootPath);
        }
        if (context?.repositoryId) {
            query.set('repositoryId', context.repositoryId);
        }
        if (context?.stageId) {
            query.set('stageId', context.stageId);
        }
        if (context?.taskId) {
            query.set('taskId', context.taskId);
        }
        if (context?.sessionId) {
            query.set('sessionId', context.sessionId);
        }

        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        return `/api/runtime/missions/${encodeURIComponent(missionId)}/actions${suffix}`;
    }

    private buildDocumentsUrl(missionId: string, filePath: string): string {
        const query = new URLSearchParams({
            path: filePath
        });
        if (this.repositoryRootPath) {
            query.set('repositoryRootPath', this.repositoryRootPath);
        }

        return `/api/runtime/missions/${encodeURIComponent(missionId)}/documents?${query.toString()}`;
    }

    private async sendSessionRequest(
        missionId: string,
        sessionId: string,
        body:
            | { action: 'complete' }
            | { action: 'cancel' | 'terminate'; reason?: string }
            | { action: 'prompt'; prompt: AgentPrompt }
            | { action: 'command'; command: AgentCommand }
    ): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = missionId.trim();
        const normalizedSessionId = sessionId.trim();
        if (!normalizedMissionId || !normalizedSessionId) {
            throw new Error('Mission session commands require missionId and sessionId.');
        }

        const payload = parseMissionSessionCommandPayload(body);

        return parseMissionRuntimeSnapshot(await this.commandRemote({
            entity: missionEntityName,
            method: 'sessionCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                sessionId: normalizedSessionId,
                command: payload
            }
        }));
    }

    private buildMissionPayload(missionId: string): { missionId: string; repositoryRootPath?: string } {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission entity commands require a missionId.');
        }

        return {
            missionId: normalizedMissionId,
            ...(this.repositoryRootPath ? { repositoryRootPath: this.repositoryRootPath } : {})
        };
    }

    private buildQuerySuffix(): string {
        if (!this.repositoryRootPath) {
            return '';
        }

        const query = new URLSearchParams({
            repositoryRootPath: this.repositoryRootPath
        });
        return `?${query.toString()}`;
    }
}