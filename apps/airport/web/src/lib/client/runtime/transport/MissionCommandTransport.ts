// /apps/airport/web/src/lib/client/runtime/transport/MissionCommandTransport.ts: Snapshot-and-command transport for mission task and session operations.
import type {
    AgentCommand as AgentCommand,
    AgentPrompt as AgentPrompt,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/airport/runtime';
import {
    missionRuntimeMissionCommandSchema,
    missionRuntimeSnapshotSchema,
    missionRuntimeSessionCommandSchema,
    missionRuntimeTaskCommandSchema
} from '@flying-pillow/mission-core/airport/runtime';
import type { MissionCommandGateway } from '$lib/client/entities/Mission';

export class MissionCommandTransport implements MissionCommandGateway {
    private readonly fetcher: typeof fetch;
    private readonly repositoryRootPath?: string;

    public constructor(input: { fetch?: typeof fetch; repositoryRootPath?: string } = {}) {
        this.fetcher = input.fetch ?? fetch;
        this.repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
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

        const payload = missionRuntimeTaskCommandSchema.parse(body);
        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/tasks/${encodeURIComponent(normalizedTaskId)}${this.buildQuerySuffix()}`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            throw new Error(`Mission task command '${payload.action}' failed for '${normalizedTaskId}' (${response.status}).`);
        }

        return missionRuntimeSnapshotSchema.parse(await response.json());
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

        const payload = missionRuntimeMissionCommandSchema.parse(body);
        const actionId = this.resolveMissionActionId(payload.action);
        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/actions${this.buildQuerySuffix()}`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ actionId })
            }
        );

        if (!response.ok) {
            throw new Error(`Mission command '${payload.action}' failed for '${normalizedMissionId}' (${response.status}).`);
        }

        return missionRuntimeSnapshotSchema.parse(await response.json());
    }

    private resolveMissionActionId(
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver'
    ): string {
        switch (action) {
            case 'pause':
                return 'mission.pause';
            case 'resume':
                return 'mission.resume';
            case 'panic':
                return 'mission.panic';
            case 'clearPanic':
                return 'mission.clear-panic';
            case 'restartQueue':
                return 'mission.restart-queue';
            case 'deliver':
                return 'mission.deliver';
        }
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

        const payload = missionRuntimeSessionCommandSchema.parse(body);
        const response = await this.fetcher(
            `/api/runtime/missions/${encodeURIComponent(normalizedMissionId)}/sessions/${encodeURIComponent(normalizedSessionId)}${this.buildQuerySuffix()}`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            throw new Error(`Mission session command '${payload.action}' failed for '${normalizedSessionId}' (${response.status}).`);
        }

        return missionRuntimeSnapshotSchema.parse(await response.json());
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