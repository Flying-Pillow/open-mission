// /apps/airport/web/src/lib/client/runtime/transport/MissionCommandTransport.ts: Mission-only snapshot and command transport.
import type {
    MissionActionQueryContext,
    MissionActionListSnapshot,
    MissionCommandAcknowledgement,
    MissionProjectionSnapshot,
    OperatorActionExecutionStep
} from '@flying-pillow/mission-core/schemas';
import type {
    EntityCommandInvocation,
    EntityQueryInvocation,
    EntityRemoteResult
} from '@flying-pillow/mission-core/schemas';
import {
    missionActionListSnapshotSchema,
    missionCommandAcknowledgementSchema,
    missionDocumentSnapshotSchema,
    missionMissionCommandSchema,
    missionProjectionSnapshotSchema,
    missionWorktreeSnapshotSchema
} from '@flying-pillow/mission-core/schemas';
import type {
    MissionCommandGateway,
    MissionDocumentPayload
} from '$lib/components/entities/Mission/Mission.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

type EntityCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;
type EntityQueryExecutionContext = 'event' | 'render';
type EntityQueryExecutor = (
    input: EntityQueryInvocation,
    context?: EntityQueryExecutionContext
) => Promise<EntityRemoteResult>;
const missionEntityName = 'Mission';

async function executeDefaultQueryRemote(
    input: EntityQueryInvocation,
    context: EntityQueryExecutionContext = 'event'
): Promise<EntityRemoteResult> {
    const remoteQuery = qry(input);
    if (context === 'render') {
        return await remoteQuery;
    }

    return await remoteQuery.run();
}

export class MissionCommandTransport implements MissionCommandGateway {
    private readonly repositoryRootPath?: string;
    private readonly commandRemote: EntityCommandExecutor;
    private readonly queryRemote: EntityQueryExecutor;

    public constructor(input: {
        fetch?: typeof fetch;
        repositoryRootPath?: string;
        commandRemote?: EntityCommandExecutor;
        queryRemote?: EntityQueryExecutor;
    } = {}) {
        this.repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
        this.commandRemote = input.commandRemote ?? cmd;
        this.queryRemote = input.queryRemote ?? executeDefaultQueryRemote;
    }

    public pauseMission(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'pause' });
    }

    public resumeMission(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'resume' });
    }

    public panicMission(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'panic' });
    }

    public clearMissionPanic(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'clearPanic' });
    }

    public restartMissionQueue(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'restartQueue' });
    }

    public deliverMission(input: { missionId: string }): Promise<MissionCommandAcknowledgement> {
        return this.sendMissionCommand(input.missionId, { action: 'deliver' });
    }

    public async getMissionProjection(input: {
        missionId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<MissionProjectionSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission projection queries require a missionId.');
        }

        return missionProjectionSnapshotSchema.parse(await this.queryRemote({
            entity: missionEntityName,
            method: 'readProjection',
            payload: this.buildMissionPayload(normalizedMissionId)
        }, input.executionContext));
    }

    public async getMissionActions(input: {
        missionId: string;
        context?: MissionActionQueryContext;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<MissionActionListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission action queries require a missionId.');
        }

        return missionActionListSnapshotSchema.parse(await this.queryRemote({
            entity: missionEntityName,
            method: 'listActions',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                ...(input.context ? { context: input.context } : {})
            }
        }, input.executionContext));
    }

    public async executeMissionAction(input: {
        missionId: string;
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<MissionCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedActionId = input.actionId.trim();
        if (!normalizedMissionId || !normalizedActionId) {
            throw new Error('Mission action commands require missionId and actionId.');
        }

        return missionCommandAcknowledgementSchema.parse(await this.commandRemote({
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
        executionContext?: EntityQueryExecutionContext;
    }): Promise<MissionDocumentPayload> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedPath = input.path.trim();
        if (!normalizedMissionId || !normalizedPath) {
            throw new Error('Mission document queries require missionId and path.');
        }

        return missionDocumentSnapshotSchema.parse(await this.queryRemote({
            entity: missionEntityName,
            method: 'readDocument',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                path: normalizedPath
            }
        }, input.executionContext));
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

        return missionDocumentSnapshotSchema.parse(await this.commandRemote({
            entity: missionEntityName,
            method: 'writeDocument',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                path: normalizedPath,
                content: input.content
            }
        }));
    }

    public async getMissionWorktree(input: {
        missionId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<MissionFileTreeResponse> {
        const normalizedMissionId = input.missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission worktree queries require a missionId.');
        }

        return missionWorktreeSnapshotSchema.parse(await this.queryRemote({
            entity: missionEntityName,
            method: 'readWorktree',
            payload: this.buildMissionPayload(normalizedMissionId)
        }, input.executionContext));
    }

    private async sendMissionCommand(
        missionId: string,
        body: {
            action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
        }
    ): Promise<MissionCommandAcknowledgement> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission commands require a missionId.');
        }

        const payload = missionMissionCommandSchema.parse(body);

        return missionCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: missionEntityName,
            method: 'command',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
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

}