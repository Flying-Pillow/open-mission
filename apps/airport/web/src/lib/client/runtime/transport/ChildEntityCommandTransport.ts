// /apps/airport/web/src/lib/client/runtime/transport/ChildEntityCommandTransport.ts: Child entity command transport for Stage, Task, Artifact, and AgentSession mirrors.
import type {
    AgentSessionCommandAcknowledgement,
    AgentSessionCommandListSnapshot,
    ArtifactCommandAcknowledgement,
    ArtifactCommandListSnapshot,
    EntityCommandInvocation,
    EntityQueryInvocation,
    EntityRemoteResult,
    MissionAgentCommand as AgentCommand,
    MissionAgentPrompt as AgentPrompt,
    StageCommandAcknowledgement,
    StageCommandListSnapshot,
    TaskCommandAcknowledgement,
    TaskCommandListSnapshot
} from '@flying-pillow/mission-core/schemas';
import {
    agentSessionCommandAcknowledgementSchema,
    agentSessionCommandListSnapshotSchema,
    artifactCommandAcknowledgementSchema,
    artifactCommandListSnapshotSchema,
    artifactDocumentSnapshotSchema,
    stageCommandAcknowledgementSchema,
    stageCommandListSnapshotSchema,
    taskCommandAcknowledgementSchema,
    taskCommandListSnapshotSchema
} from '@flying-pillow/mission-core/schemas';
import type {
    MissionChildEntityCommandGateway,
    MissionDocumentPayload
} from '$lib/components/entities/Mission/Mission.svelte.js';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

type EntityCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;
type EntityQueryExecutionContext = 'event' | 'render';
type EntityQueryExecutor = (
    input: EntityQueryInvocation,
    context?: EntityQueryExecutionContext
) => Promise<EntityRemoteResult>;

const stageEntityName = 'Stage';
const taskEntityName = 'Task';
const artifactEntityName = 'Artifact';
const agentSessionEntityName = 'AgentSession';

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

export class ChildEntityCommandTransport implements MissionChildEntityCommandGateway {
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

    public async listStageCommands(input: {
        missionId: string;
        stageId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<StageCommandListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedStageId = input.stageId.trim();
        if (!normalizedMissionId || !normalizedStageId) {
            throw new Error('Stage command queries require missionId and stageId.');
        }

        return stageCommandListSnapshotSchema.parse(await this.queryRemote({
            entity: stageEntityName,
            method: 'listCommands',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                stageId: normalizedStageId
            }
        }, input.executionContext));
    }

    public async executeStageCommand(input: {
        missionId: string;
        stageId: string;
        commandId: string;
        input?: unknown;
    }): Promise<StageCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedStageId = input.stageId.trim();
        const normalizedCommandId = input.commandId.trim();
        if (!normalizedMissionId || !normalizedStageId || !normalizedCommandId) {
            throw new Error('Stage commands require missionId, stageId, and commandId.');
        }

        return stageCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: stageEntityName,
            method: 'executeCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                stageId: normalizedStageId,
                commandId: normalizedCommandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        }));
    }

    public async listTaskCommands(input: {
        missionId: string;
        taskId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<TaskCommandListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedTaskId = input.taskId.trim();
        if (!normalizedMissionId || !normalizedTaskId) {
            throw new Error('Task command queries require missionId and taskId.');
        }

        return taskCommandListSnapshotSchema.parse(await this.queryRemote({
            entity: taskEntityName,
            method: 'listCommands',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                taskId: normalizedTaskId
            }
        }, input.executionContext));
    }

    public async executeTaskCommand(input: {
        missionId: string;
        taskId: string;
        commandId: string;
        input?: unknown;
    }): Promise<TaskCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedTaskId = input.taskId.trim();
        const normalizedCommandId = input.commandId.trim();
        if (!normalizedMissionId || !normalizedTaskId || !normalizedCommandId) {
            throw new Error('Task commands require missionId, taskId, and commandId.');
        }

        return taskCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: taskEntityName,
            method: 'executeCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                taskId: normalizedTaskId,
                commandId: normalizedCommandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        }));
    }

    public async listArtifactCommands(input: {
        missionId: string;
        artifactId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<ArtifactCommandListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedArtifactId = input.artifactId.trim();
        if (!normalizedMissionId || !normalizedArtifactId) {
            throw new Error('Artifact command queries require missionId and artifactId.');
        }

        return artifactCommandListSnapshotSchema.parse(await this.queryRemote({
            entity: artifactEntityName,
            method: 'listCommands',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                artifactId: normalizedArtifactId
            }
        }, input.executionContext));
    }

    public async executeArtifactCommand(input: {
        missionId: string;
        artifactId: string;
        commandId: string;
        input?: unknown;
    }): Promise<ArtifactCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedArtifactId = input.artifactId.trim();
        const normalizedCommandId = input.commandId.trim();
        if (!normalizedMissionId || !normalizedArtifactId || !normalizedCommandId) {
            throw new Error('Artifact commands require missionId, artifactId, and commandId.');
        }

        return artifactCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: artifactEntityName,
            method: 'executeCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                artifactId: normalizedArtifactId,
                commandId: normalizedCommandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        }));
    }

    public async listAgentSessionCommands(input: {
        missionId: string;
        sessionId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<AgentSessionCommandListSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedSessionId = input.sessionId.trim();
        if (!normalizedMissionId || !normalizedSessionId) {
            throw new Error('AgentSession command queries require missionId and sessionId.');
        }

        return agentSessionCommandListSnapshotSchema.parse(await this.queryRemote({
            entity: agentSessionEntityName,
            method: 'listCommands',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                sessionId: normalizedSessionId
            }
        }, input.executionContext));
    }

    public async executeAgentSessionCommand(input: {
        missionId: string;
        sessionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentSessionCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedSessionId = input.sessionId.trim();
        const normalizedCommandId = input.commandId.trim();
        if (!normalizedMissionId || !normalizedSessionId || !normalizedCommandId) {
            throw new Error('AgentSession commands require missionId, sessionId, and commandId.');
        }

        return agentSessionCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: agentSessionEntityName,
            method: 'executeCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                sessionId: normalizedSessionId,
                commandId: normalizedCommandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        }));
    }

    public async sendAgentSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<AgentSessionCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedSessionId = input.sessionId.trim();
        if (!normalizedMissionId || !normalizedSessionId) {
            throw new Error('AgentSession prompt commands require missionId and sessionId.');
        }

        return agentSessionCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: agentSessionEntityName,
            method: 'sendPrompt',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                sessionId: normalizedSessionId,
                prompt: input.prompt
            }
        }));
    }

    public async sendAgentSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
    }): Promise<AgentSessionCommandAcknowledgement> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedSessionId = input.sessionId.trim();
        if (!normalizedMissionId || !normalizedSessionId) {
            throw new Error('AgentSession terminal commands require missionId and sessionId.');
        }

        return agentSessionCommandAcknowledgementSchema.parse(await this.commandRemote({
            entity: agentSessionEntityName,
            method: 'sendCommand',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                sessionId: normalizedSessionId,
                command: input.command
            }
        }));
    }

    public async readArtifactDocument(input: {
        missionId: string;
        artifactId: string;
        executionContext?: EntityQueryExecutionContext;
    }): Promise<MissionDocumentPayload> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedArtifactId = input.artifactId.trim();
        if (!normalizedMissionId || !normalizedArtifactId) {
            throw new Error('Artifact document queries require missionId and artifactId.');
        }

        return artifactDocumentSnapshotSchema.parse(await this.queryRemote({
            entity: artifactEntityName,
            method: 'readDocument',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                artifactId: normalizedArtifactId
            }
        }, input.executionContext));
    }

    public async writeArtifactDocument(input: {
        missionId: string;
        artifactId: string;
        content: string;
    }): Promise<MissionDocumentPayload> {
        const normalizedMissionId = input.missionId.trim();
        const normalizedArtifactId = input.artifactId.trim();
        if (!normalizedMissionId || !normalizedArtifactId) {
            throw new Error('Artifact document commands require missionId and artifactId.');
        }

        return artifactDocumentSnapshotSchema.parse(await this.commandRemote({
            entity: artifactEntityName,
            method: 'writeDocument',
            payload: {
                ...this.buildMissionPayload(normalizedMissionId),
                artifactId: normalizedArtifactId,
                content: input.content
            }
        }));
    }

    private buildMissionPayload(missionId: string): { missionId: string; repositoryRootPath?: string } {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Child entity commands require a missionId.');
        }

        return {
            missionId: normalizedMissionId,
            ...(this.repositoryRootPath ? { repositoryRootPath: this.repositoryRootPath } : {})
        };
    }
}