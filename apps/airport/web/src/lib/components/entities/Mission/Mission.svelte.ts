// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';
import {
    AgentSessionCommandAcknowledgementSchema,
    type AgentSessionCommandAcknowledgementType as AgentSessionCommandAcknowledgement,
    type AgentSessionCommandType as AgentCommand,
    type AgentSessionPromptType as AgentPrompt,
    type AgentSessionDataType as AgentSessionSnapshot
} from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import {
    ArtifactDocumentDataSchema,
    type ArtifactDataType as MissionArtifactSnapshot
} from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import {
    MissionCommandAcknowledgementSchema,
    MissionDocumentSnapshotSchema,
    MissionProjectionSnapshotSchema,
    MissionWorktreeSnapshotSchema,
    type MissionCommandAcknowledgementType as MissionCommandAcknowledgement,
    type MissionProjectionSnapshotType as MissionProjectionSnapshot,
    type MissionSnapshotType as MissionSnapshot,
    type MissionStatusSnapshotType as MissionStatusSnapshot
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    StageCommandAcknowledgementSchema,
    type StageDataType as MissionStageSnapshot,
    type StageCommandAcknowledgementType as StageCommandAcknowledgement
} from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import {
    TaskCommandAcknowledgementSchema,
    type TaskDataType as MissionTaskSnapshot,
    type TaskCommandAcknowledgementType as TaskCommandAcknowledgement
} from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import { AgentSession } from '$lib/components/entities/AgentSession/AgentSession.svelte.js';
import {
    Artifact,
    type ArtifactDocumentPayload,
    type ArtifactSnapshot
} from '$lib/components/entities/Artifact/Artifact.svelte.js';
import { EntityRegistry, type EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Stage, type StageSnapshot } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    Task,
    type TaskSnapshot
} from '$lib/components/entities/Task/Task.svelte.js';

export type MissionDataLoader = (missionId: string) => Promise<MissionSnapshot>;
type MissionQueryExecutionContext = 'event' | 'render';
export type MissionDocumentPayload = ArtifactDocumentPayload;
type EntityCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;
type EntityQueryExecutor = (
    input: EntityQueryInvocation,
    context?: MissionQueryExecutionContext
) => Promise<EntityRemoteResult>;

export type MissionGatewayDependencies = {
    repositoryRootPath?: string;
    commandRemote: EntityCommandExecutor;
    queryRemote: EntityQueryExecutor;
};

type MissionCommandGateway = {
    executeMissionCommand(input: {
        missionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<MissionCommandAcknowledgement>;
    getMissionProjection(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionProjectionSnapshot>;
    readMissionDocument(input: {
        missionId: string;
        path: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionDocumentPayload>;
    writeMissionDocument(input: {
        missionId: string;
        path: string;
        content: string;
    }): Promise<MissionDocumentPayload>;
    getMissionWorktree(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionFileTreeResponse>;
};

type MissionChildEntityCommandGateway = {
    executeStageCommand(input: {
        missionId: string;
        stageId: string;
        commandId: string;
        input?: unknown;
    }): Promise<StageCommandAcknowledgement>;
    executeTaskCommand(input: {
        missionId: string;
        taskId: string;
        commandId: string;
        input?: unknown;
    }): Promise<TaskCommandAcknowledgement>;
    executeAgentSessionCommand(input: {
        missionId: string;
        sessionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentSessionCommandAcknowledgement>;
    sendAgentSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<AgentSessionCommandAcknowledgement>;
    sendAgentSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
    }): Promise<AgentSessionCommandAcknowledgement>;
    readArtifactDocument(input: {
        missionId: string;
        artifactId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionDocumentPayload>;
    writeArtifactDocument(input: {
        missionId: string;
        artifactId: string;
        content: string;
    }): Promise<MissionDocumentPayload>;
};

export type MissionDependencies = {
    snapshot: MissionSnapshot;
    loadData: MissionDataLoader;
    gatewayDependencies: MissionGatewayDependencies;
};

const missionEntityName = 'Mission';
const stageEntityName = 'Stage';
const taskEntityName = 'Task';
const artifactEntityName = 'Artifact';
const agentSessionEntityName = 'AgentSession';

function createMissionCommandGateway(input: MissionGatewayDependencies): MissionCommandGateway {
    const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    const { commandRemote, queryRemote } = input;

    return {
        executeMissionCommand: async ({ missionId, commandId, input: commandInput }) => sendMissionCommand(commandRemote, {
            missionId,
            commandId,
            ...(commandInput !== undefined ? { input: commandInput } : {})
        }, repositoryRootPath),
        getMissionProjection: async ({ missionId, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission projection queries require a missionId.');
            return MissionProjectionSnapshotSchema.parse(await queryRemote({
                entity: missionEntityName,
                method: 'readProjection',
                payload: buildMissionPayload(normalizedMissionId, repositoryRootPath)
            }, executionContext));
        },
        readMissionDocument: async ({ missionId, path, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission document queries require missionId and path.');
            const normalizedPath = path.trim();
            if (!normalizedPath) {
                throw new Error('Mission document queries require missionId and path.');
            }

            return MissionDocumentSnapshotSchema.parse(await queryRemote({
                entity: missionEntityName,
                method: 'readDocument',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    path: normalizedPath
                }
            }, executionContext));
        },
        writeMissionDocument: async ({ missionId, path, content }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission document commands require missionId and path.');
            const normalizedPath = path.trim();
            if (!normalizedPath) {
                throw new Error('Mission document commands require missionId and path.');
            }

            return MissionDocumentSnapshotSchema.parse(await commandRemote({
                entity: missionEntityName,
                method: 'writeDocument',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    path: normalizedPath,
                    content
                }
            }));
        },
        getMissionWorktree: async ({ missionId, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission worktree queries require a missionId.');
            return MissionWorktreeSnapshotSchema.parse(await queryRemote({
                entity: missionEntityName,
                method: 'readWorktree',
                payload: buildMissionPayload(normalizedMissionId, repositoryRootPath)
            }, executionContext));
        }
    };
}

function createMissionChildEntityCommandGateway(input: MissionGatewayDependencies): MissionChildEntityCommandGateway {
    const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    const { commandRemote, queryRemote } = input;

    return {
        executeStageCommand: async ({ missionId, stageId, commandId, input: commandInput }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Stage commands require missionId, stageId, and commandId.');
            const normalizedStageId = requireNonEmptyValue(stageId, 'Stage commands require missionId, stageId, and commandId.');
            const normalizedCommandId = requireNonEmptyValue(commandId, 'Stage commands require missionId, stageId, and commandId.');
            return StageCommandAcknowledgementSchema.parse(await commandRemote({
                entity: stageEntityName,
                method: 'executeCommand',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    stageId: normalizedStageId,
                    commandId: normalizedCommandId,
                    ...(commandInput !== undefined ? { input: commandInput } : {})
                }
            }));
        },
        executeTaskCommand: async ({ missionId, taskId, commandId, input: commandInput }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Task commands require missionId, taskId, and commandId.');
            const normalizedTaskId = requireNonEmptyValue(taskId, 'Task commands require missionId, taskId, and commandId.');
            const normalizedCommandId = requireNonEmptyValue(commandId, 'Task commands require missionId, taskId, and commandId.');
            return TaskCommandAcknowledgementSchema.parse(await commandRemote({
                entity: taskEntityName,
                method: 'executeCommand',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    taskId: normalizedTaskId,
                    commandId: normalizedCommandId,
                    ...(commandInput !== undefined ? { input: commandInput } : {})
                }
            }));
        },
        executeAgentSessionCommand: async ({ missionId, sessionId, commandId, input: commandInput }) => {
            const normalizedMissionId = requireMissionId(missionId, 'AgentSession commands require missionId, sessionId, and commandId.');
            const normalizedSessionId = requireNonEmptyValue(sessionId, 'AgentSession commands require missionId, sessionId, and commandId.');
            const normalizedCommandId = requireNonEmptyValue(commandId, 'AgentSession commands require missionId, sessionId, and commandId.');
            return AgentSessionCommandAcknowledgementSchema.parse(await commandRemote({
                entity: agentSessionEntityName,
                method: 'executeCommand',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    sessionId: normalizedSessionId,
                    commandId: normalizedCommandId,
                    ...(commandInput !== undefined ? { input: commandInput } : {})
                }
            }));
        },
        sendAgentSessionPrompt: async ({ missionId, sessionId, prompt }) => {
            const normalizedMissionId = requireMissionId(missionId, 'AgentSession prompt commands require missionId and sessionId.');
            const normalizedSessionId = requireNonEmptyValue(sessionId, 'AgentSession prompt commands require missionId and sessionId.');
            return AgentSessionCommandAcknowledgementSchema.parse(await commandRemote({
                entity: agentSessionEntityName,
                method: 'sendPrompt',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    sessionId: normalizedSessionId,
                    prompt
                }
            }));
        },
        sendAgentSessionCommand: async ({ missionId, sessionId, command }) => {
            const normalizedMissionId = requireMissionId(missionId, 'AgentSession terminal commands require missionId and sessionId.');
            const normalizedSessionId = requireNonEmptyValue(sessionId, 'AgentSession terminal commands require missionId and sessionId.');
            return AgentSessionCommandAcknowledgementSchema.parse(await commandRemote({
                entity: agentSessionEntityName,
                method: 'sendCommand',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    sessionId: normalizedSessionId,
                    command
                }
            }));
        },
        readArtifactDocument: async ({ missionId, artifactId, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Artifact document queries require missionId and artifactId.');
            const normalizedArtifactId = requireNonEmptyValue(artifactId, 'Artifact document queries require missionId and artifactId.');
            return ArtifactDocumentDataSchema.parse(await queryRemote({
                entity: artifactEntityName,
                method: 'readDocument',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    artifactId: normalizedArtifactId
                }
            }, executionContext));
        },
        writeArtifactDocument: async ({ missionId, artifactId, content }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Artifact document commands require missionId and artifactId.');
            const normalizedArtifactId = requireNonEmptyValue(artifactId, 'Artifact document commands require missionId and artifactId.');
            return ArtifactDocumentDataSchema.parse(await commandRemote({
                entity: artifactEntityName,
                method: 'writeDocument',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    artifactId: normalizedArtifactId,
                    content
                }
            }));
        }
    };
}

export class Mission implements EntityModel<MissionSnapshot> {
    private readonly loadData: MissionDataLoader;
    private readonly commandGateway: MissionCommandGateway;
    private readonly childCommands: MissionChildEntityCommandGateway;
    private snapshotState = $state<MissionSnapshot | undefined>();
    private projectionSnapshotState = $state<MissionProjectionSnapshot | undefined>();
    private worktreePathState = $state<string | undefined>();
    private readonly sessions = new EntityRegistry<string, AgentSessionSnapshot, AgentSession>();
    private readonly stages = new EntityRegistry<string, StageSnapshot, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();
    private readonly artifacts = new EntityRegistry<string, ArtifactSnapshot, Artifact>();

    public constructor(input: MissionDependencies) {
        this.snapshot = input.snapshot;
        this.loadData = input.loadData;
        this.commandGateway = createMissionCommandGateway(input.gatewayDependencies);
        this.childCommands = createMissionChildEntityCommandGateway(input.gatewayDependencies);
        this.applySessionSnapshots(input.snapshot.agentSessions);
        this.applyTaskSnapshots(input.snapshot);
        this.applyStageSnapshots(input.snapshot);
        this.applyArtifactSnapshots(input.snapshot);
    }

    private get snapshot(): MissionSnapshot {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Mission snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: MissionSnapshot) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get missionId(): string {
        return this.snapshot.mission.missionId;
    }

    public get id(): string {
        return this.missionId;
    }

    public get entityName(): 'Mission' {
        return 'Mission';
    }

    public get entityId(): string {
        return this.missionId;
    }

    public get operationalMode(): string | undefined {
        return this.snapshot.status?.operationalMode ?? this.snapshot.mission.operationalMode;
    }

    public get workflowLifecycle(): string | undefined {
        return this.snapshot.workflow?.lifecycle ?? this.snapshot.status?.workflow?.lifecycle;
    }

    public get workflowUpdatedAt(): string | undefined {
        return this.snapshot.workflow?.updatedAt ?? this.snapshot.status?.workflow?.updatedAt;
    }

    public get projectionSnapshot(): MissionProjectionSnapshot | undefined {
        const snapshot = $state.snapshot(this.projectionSnapshotState);
        return snapshot ? structuredClone(snapshot) : undefined;
    }

    public get missionWorktreePath(): string | undefined {
        return this.worktreePathState;
    }

    public get commands(): EntityCommandDescriptorType[] {
        const commands = this.snapshot.mission.commands;
        if (commands) {
            return structuredClone($state.snapshot(commands));
        }

        return [];
    }

    public setRouteState(input: {
        projectionSnapshot?: MissionProjectionSnapshot;
        worktreePath?: string;
    }): this {
        this.worktreePathState = input.worktreePath?.trim() || undefined;

        if (!input.projectionSnapshot) {
            this.projectionSnapshotState = undefined;
            return this;
        }

        return this.applyProjectionSnapshot(input.projectionSnapshot);
    }

    public async pause(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.pause' }));
    }

    public async resume(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.resume' }));
    }

    public async panic(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.panic' }));
    }

    public async clearPanic(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.clearPanic' }));
    }

    public async restartQueue(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.restartQueue' }));
    }

    public async deliver(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: 'mission.deliver' }));
    }

    public async getProjectionSnapshot(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionProjectionSnapshot> {
        const snapshot = await this.commandGateway.getMissionProjection({
            missionId: this.missionId,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
        this.applyProjectionSnapshot(snapshot);
        return snapshot;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.commandGateway.executeMissionCommand({
            missionId: this.missionId,
            commandId,
            ...(input !== undefined ? { input } : {})
        });
        await this.refresh();
    }

    public async readDocument(path: string, input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionDocumentPayload> {
        return this.commandGateway.readMissionDocument({
            missionId: this.missionId,
            path,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public async writeDocument(
        path: string,
        content: string
    ): Promise<MissionDocumentPayload> {
        return this.commandGateway.writeMissionDocument({
            missionId: this.missionId,
            path,
            content
        });
    }

    public async getWorktree(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionFileTreeResponse> {
        return this.commandGateway.getMissionWorktree({
            missionId: this.missionId,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public listStages(): Stage[] {
        return this.stages.values();
    }

    public getStage(stageId: string): Stage | undefined {
        return this.stages.get(stageId);
    }

    public listSessions(): AgentSession[] {
        return this.sessions.values();
    }

    public listArtifacts(): Artifact[] {
        return this.artifacts.values();
    }

    public listTasks(): Task[] {
        return this.tasks.values();
    }

    public getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    public listTasksForStage(stageId: string): Task[] {
        return this.getStage(stageId)?.listTasks() ?? [];
    }

    public getSession(sessionId: string): AgentSession | undefined {
        return this.sessions.get(sessionId);
    }

    public getArtifact(filePath: string): Artifact | undefined {
        return this.artifacts.get(filePath);
    }

    public resolveArtifact(input: {
        filePath: string;
        label?: string;
        stageId?: string;
        taskId?: string;
    }): Artifact {
        const snapshot = toArtifactIdentitySnapshot(input);
        const existingArtifact = this.getArtifact(snapshot.filePath);

        if (existingArtifact) {
            return existingArtifact;
        }

        return this.createArtifactEntity(snapshot);
    }

    public async refresh(): Promise<this> {
        this.applySnapshot(await this.loadData(this.missionId));
        return this;
    }

    public updateFromData(snapshot: MissionSnapshot): this {
        this.snapshot = snapshot;
        this.applySessionSnapshots(snapshot.agentSessions);
        this.applyTaskSnapshots(snapshot);
        this.applyStageSnapshots(snapshot);
        this.applyArtifactSnapshots(snapshot);
        return this;
    }

    public applyMissionStatus(status: MissionStatusSnapshot): this {
        const projectionSnapshot = this.projectionSnapshot;
        if (!projectionSnapshot) {
            return this;
        }

        return this.applyProjectionSnapshot({
            ...projectionSnapshot,
            status: structuredClone(status)
        });
    }

    public applyMissionSnapshot(snapshot: MissionSnapshot): this {
        return this.applySnapshot(snapshot);
    }

    public applyStageSnapshot(snapshot: MissionStageSnapshot): this {
        const nextStages = upsertById(
            this.stages.values().map((stage) => stage.toData()),
            snapshot,
            (stage) => stage.stageId
        );

        this.applyStageSnapshotsFromStages(nextStages);
        this.applyTaskSnapshotsForStage(snapshot);
        this.applyArtifactDataSnapshotsForStage(snapshot);
        this.updateProjectionStageSnapshot(snapshot);
        return this;
    }

    public applyTaskSnapshot(snapshot: MissionTaskSnapshot): this {
        this.applyTaskDataSnapshot(snapshot);
        this.updateProjectionTaskSnapshot(snapshot);
        return this;
    }

    public applyArtifactSnapshot(snapshot: MissionArtifactSnapshot): this {
        this.applyArtifactProjectionSnapshot(snapshot);
        this.updateProjectionArtifactSnapshot(snapshot);
        return this;
    }

    public applyProjectionSnapshot(snapshot: MissionProjectionSnapshot): this {
        this.projectionSnapshotState = structuredClone(snapshot);

        const stageSnapshots = snapshot.workflow?.stages ?? snapshot.status?.workflow?.stages;
        if (stageSnapshots) {
            this.applyTaskSnapshotsFromStages(stageSnapshots);
            this.applyStageSnapshotsFromStages(stageSnapshots);
        }

        const artifactSnapshots = snapshot.status?.artifacts
            ?? stageSnapshots?.flatMap((stage) => stage.artifacts);
        if (artifactSnapshots) {
            this.applyArtifactDataSnapshots(artifactSnapshots);
        }

        return this;
    }

    public applyAgentSessionSnapshot(snapshot: AgentSessionSnapshot): this {
        const nextSessions = [
            ...this.sessions
                .values()
                .map((session) => session.toData())
                .filter((session) => session.sessionId !== snapshot.sessionId),
            snapshot
        ];

        this.applySessionSnapshots(nextSessions);
        return this;
    }

    public applySnapshot(snapshot: MissionSnapshot): this {
        return this.updateFromData(snapshot);
    }

    public toData(): MissionSnapshot {
        return {
            ...structuredClone($state.snapshot(this.snapshot)),
            agentSessions: this.listSessions().map((session) => session.toData())
        };
    }

    public toJSON(): MissionSnapshot {
        return this.toData();
    }

    private applySessionSnapshots(sessionSnapshots: AgentSessionSnapshot[]): void {
        this.sessions.reconcile(
            sessionSnapshots,
            (sessionSnapshot) => sessionSnapshot.sessionId,
            (sessionSnapshot) => new AgentSession(sessionSnapshot, {
                executeCommand: async (sessionId, commandId, input) => {
                    await this.childCommands.executeAgentSessionCommand({
                        missionId: this.missionId,
                        sessionId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                },
                sendPrompt: async (sessionId, prompt) => {
                    await this.childCommands.sendAgentSessionPrompt({
                        missionId: this.missionId,
                        sessionId,
                        prompt
                    });
                    await this.refresh();
                },
                sendCommand: async (sessionId, command) => {
                    await this.childCommands.sendAgentSessionCommand({
                        missionId: this.missionId,
                        sessionId,
                        command
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyTaskSnapshots(snapshot: MissionSnapshot): void {
        this.applyTaskSnapshotsFromStages(snapshot.stages);
    }

    private applyTaskSnapshotsFromStages(stages: MissionStageSnapshot[]): void {
        const taskSnapshots: TaskSnapshot[] = stages.flatMap((stage) =>
            stage.tasks.map((task) => ({
                stageId: stage.stageId,
                task
            }))
        );

        this.tasks.reconcile(
            taskSnapshots,
            (taskSnapshot) => taskSnapshot.task.taskId,
            (taskSnapshot) => new Task(taskSnapshot, {
                executeCommand: async (taskId, commandId, input) => {
                    await this.childCommands.executeTaskCommand({
                        missionId: this.missionId,
                        taskId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyTaskSnapshotsForStage(stage: MissionStageSnapshot): void {
        const taskSnapshots = [
            ...this.tasks
                .values()
                .map((task) => task.toData())
                .filter((task) => task.stageId !== stage.stageId),
            ...stage.tasks.map((task) => ({
                stageId: stage.stageId,
                task
            }))
        ];

        this.reconcileTaskSnapshots(taskSnapshots);
    }

    private applyTaskDataSnapshot(task: MissionTaskSnapshot): void {
        const nextTaskSnapshot: TaskSnapshot = {
            stageId: task.stageId,
            task
        };
        const taskSnapshots = upsertById(
            this.tasks.values().map((knownTask) => knownTask.toData()),
            nextTaskSnapshot,
            (snapshot) => snapshot.task.taskId
        );

        this.reconcileTaskSnapshots(taskSnapshots);
    }

    private reconcileTaskSnapshots(taskSnapshots: TaskSnapshot[]): void {
        this.tasks.reconcile(
            taskSnapshots,
            (taskSnapshot) => taskSnapshot.task.taskId,
            (taskSnapshot) => new Task(taskSnapshot, {
                executeCommand: async (taskId, commandId, input) => {
                    await this.childCommands.executeTaskCommand({
                        missionId: this.missionId,
                        taskId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyStageSnapshots(snapshot: MissionSnapshot): void {
        this.applyStageSnapshotsFromStages(snapshot.stages);
    }

    private applyStageSnapshotsFromStages(stages: MissionStageSnapshot[]): void {
        this.stages.reconcile(
            stages,
            (stage) => stage.stageId,
            (stage) => new Stage(stage, {
                resolveTask: (taskId) => this.tasks.get(taskId),
                executeCommand: async (stageId, commandId, input) => {
                    await this.childCommands.executeStageCommand({
                        missionId: this.missionId,
                        stageId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyArtifactSnapshots(snapshot: MissionSnapshot): void {
        this.applyArtifactDataSnapshots(snapshot.artifacts);
    }

    private applyArtifactDataSnapshots(artifacts: MissionArtifactSnapshot[]): void {
        const artifactSnapshots: ArtifactSnapshot[] = artifacts.map(toArtifactSnapshot);

        this.reconcileArtifactSnapshots(artifactSnapshots);
    }

    private applyArtifactDataSnapshotsForStage(stage: MissionStageSnapshot): void {
        const artifactSnapshots = [
            ...this.artifacts
                .values()
                .map((artifact) => artifact.toData())
                .filter((artifact) => artifact.stageId !== stage.stageId),
            ...stage.artifacts.map(toArtifactSnapshot)
        ];

        this.reconcileArtifactSnapshots(artifactSnapshots);
    }

    private applyArtifactProjectionSnapshot(snapshot: MissionArtifactSnapshot): void {
        const artifactSnapshot = toArtifactSnapshot(snapshot);
        const artifactSnapshots = upsertById(
            this.artifacts.values().map((artifact) => artifact.toData()),
            artifactSnapshot,
            (artifact) => artifact.artifactId
        );

        this.reconcileArtifactSnapshots(artifactSnapshots);
    }

    private reconcileArtifactSnapshots(artifactSnapshots: ArtifactSnapshot[]): void {
        this.artifacts.reconcile(
            artifactSnapshots,
            (artifactSnapshot) => artifactSnapshot.filePath,
            (artifactSnapshot) => this.createArtifactEntity(artifactSnapshot)
        );
    }

    private updateProjectionStageSnapshot(snapshot: MissionStageSnapshot): void {
        this.updateProjectionWorkflowStages((stages) => upsertById(stages, snapshot, (stage) => stage.stageId));
    }

    private updateProjectionTaskSnapshot(snapshot: MissionTaskSnapshot): void {
        this.updateProjectionWorkflowStages((stages) => stages.map((stage) => {
            if (stage.stageId !== snapshot.stageId) {
                return {
                    ...stage,
                    tasks: stage.tasks.filter((task) => task.taskId !== snapshot.taskId)
                };
            }

            return {
                ...stage,
                tasks: upsertById(stage.tasks, snapshot, (task) => task.taskId)
            };
        }));
    }

    private updateProjectionArtifactSnapshot(snapshot: MissionArtifactSnapshot): void {
        const projectionSnapshot = this.projectionSnapshot;
        if (!projectionSnapshot) {
            return;
        }

        const statusArtifacts = projectionSnapshot.status?.artifacts;
        this.applyProjectionSnapshot({
            ...projectionSnapshot,
            ...(projectionSnapshot.status
                ? {
                    status: {
                        ...projectionSnapshot.status,
                        artifacts: statusArtifacts
                            ? upsertById(statusArtifacts, snapshot, (artifact) => artifact.artifactId)
                            : [snapshot]
                    }
                }
                : {})
        });
    }

    private updateProjectionWorkflowStages(
        updateStages: (stages: MissionStageSnapshot[]) => MissionStageSnapshot[]
    ): void {
        const projectionSnapshot = this.projectionSnapshot;
        if (!projectionSnapshot) {
            return;
        }

        const hasWorkflowStages = projectionSnapshot.workflow?.stages !== undefined;
        const hasStatusWorkflowStages = projectionSnapshot.status?.workflow?.stages !== undefined;
        if (!hasWorkflowStages && !hasStatusWorkflowStages) {
            return;
        }

        this.applyProjectionSnapshot({
            ...projectionSnapshot,
            ...(projectionSnapshot.workflow && hasWorkflowStages
                ? {
                    workflow: {
                        ...projectionSnapshot.workflow,
                        stages: updateStages(projectionSnapshot.workflow.stages as MissionStageSnapshot[])
                    }
                }
                : {}),
            ...(projectionSnapshot.status?.workflow && hasStatusWorkflowStages
                ? {
                    status: {
                        ...projectionSnapshot.status,
                        workflow: {
                            ...projectionSnapshot.status.workflow,
                            stages: updateStages(projectionSnapshot.status.workflow.stages as MissionStageSnapshot[])
                        }
                    }
                }
                : {})
        });
    }

    private createArtifactEntity(snapshot: ArtifactSnapshot): Artifact {
        return new Artifact(snapshot, {
            readDocument: async (filePath, input) => {
                const artifactId = this.getArtifact(filePath)?.artifactId ?? snapshot.artifactId;
                return this.childCommands.readArtifactDocument({
                    missionId: this.missionId,
                    artifactId,
                    ...(input?.executionContext ? { executionContext: input.executionContext } : {})
                });
            },
            writeDocument: async (filePath, content) => {
                const artifactId = this.getArtifact(filePath)?.artifactId ?? snapshot.artifactId;
                return this.childCommands.writeArtifactDocument({
                    missionId: this.missionId,
                    artifactId,
                    content
                });
            }
        });
    }

    private async runCommandAndRefresh(command: Promise<MissionCommandAcknowledgement>): Promise<this> {
        await command;
        await this.refresh();
        return this;
    }
}

function upsertById<T>(dataItems: T[], snapshot: T, selectId: (snapshot: T) => string): T[] {
    const nextId = selectId(snapshot);
    let replaced = false;
    const nextSnapshots = dataItems.map((candidate) => {
        if (selectId(candidate) !== nextId) {
            return candidate;
        }

        replaced = true;
        return snapshot;
    });

    return replaced ? nextSnapshots : [...nextSnapshots, snapshot];
}

function toArtifactIdentitySnapshot(input: {
    filePath: string;
    label?: string;
    stageId?: string;
    taskId?: string;
}): ArtifactSnapshot {
    return {
        artifactId: input.filePath,
        filePath: input.filePath,
        ...(input.label?.trim() ? { label: input.label.trim() } : {}),
        ...(input.stageId?.trim() ? { stageId: input.stageId.trim() } : {}),
        ...(input.taskId?.trim() ? { taskId: input.taskId.trim() } : {})
    };
}

function requireMissionId(missionId: string, message: string): string {
    return requireNonEmptyValue(missionId, message);
}

function requireNonEmptyValue(value: string, message: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        throw new Error(message);
    }

    return normalizedValue;
}

function buildMissionPayload(missionId: string, repositoryRootPath?: string): { missionId: string; repositoryRootPath?: string } {
    return {
        missionId,
        ...(repositoryRootPath ? { repositoryRootPath } : {})
    };
}

function sendMissionCommand(
    commandRemote: EntityCommandExecutor,
    input: {
        missionId: string;
        commandId: string;
        input?: unknown;
    },
    repositoryRootPath?: string
): Promise<MissionCommandAcknowledgement> {
    const normalizedMissionId = requireMissionId(input.missionId, 'Mission commands require a missionId and commandId.');
    const normalizedCommandId = requireNonEmptyValue(input.commandId, 'Mission commands require a missionId and commandId.');

    return MissionCommandAcknowledgementSchema.parseAsync(commandRemote({
        entity: missionEntityName,
        method: 'command',
        payload: {
            ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
            commandId: normalizedCommandId,
            ...(input.input !== undefined ? { input: input.input } : {})
        }
    }));
}

function toArtifactSnapshot(artifact: MissionArtifactSnapshot): ArtifactSnapshot {
    return {
        artifactId: artifact.artifactId,
        filePath: artifact.filePath ?? artifact.relativePath ?? artifact.artifactId,
        label: artifact.label,
        ...(artifact.stageId ? { stageId: artifact.stageId } : {}),
        ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
        ...(artifact.commands ? { commands: artifact.commands } : {})
    };
}

