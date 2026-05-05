// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import {
    AgentSessionCommandAcknowledgementSchema,
    type AgentSessionCommandAcknowledgementType,
    type AgentSessionDataType
} from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import {
    ArtifactCommandAcknowledgementSchema,
    ArtifactCommandIds,
    type ArtifactCommandAcknowledgementType,
    ArtifactBodySchema,
    type ArtifactBodyType,
    type ArtifactDataType
} from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import {
    MissionCommandAcknowledgementSchema,
    MissionCommandIds,
    MissionDocumentSnapshotSchema,
    MissionControlViewSnapshotSchema,
    MissionWorktreeSnapshotSchema,
    type MissionCommandAcknowledgementType,
    type MissionCommandOwnerType,
    type MissionControlViewSnapshotType,
    type MissionDocumentSnapshotType,
    type MissionSnapshotType,
    type MissionStatusSnapshotType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    StageCommandAcknowledgementSchema,
    type StageDataType,
    type StageCommandAcknowledgementType
} from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import {
    TaskCommandAcknowledgementSchema,
    type TaskDataType,
    type TaskCommandAcknowledgementType
} from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import { AgentSession } from '$lib/components/entities/AgentSession/AgentSession.svelte.js';
import {
    Artifact
} from '$lib/components/entities/Artifact/Artifact.svelte.js';
import { EntityRegistry, type EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Stage } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    Task,
    type TaskSnapshot
} from '$lib/components/entities/Task/Task.svelte.js';

export type MissionDataLoader = (missionId: string) => Promise<MissionSnapshotType>;
type MissionQueryExecutionContext = 'event' | 'render';
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
    }): Promise<MissionCommandAcknowledgementType>;
    getMissionControlView(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionControlViewSnapshotType>;
    readMissionDocument(input: {
        missionId: string;
        path: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionDocumentSnapshotType>;
    writeMissionDocument(input: {
        missionId: string;
        path: string;
        content: string;
    }): Promise<MissionDocumentSnapshotType>;
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
    }): Promise<StageCommandAcknowledgementType>;
    executeTaskCommand(input: {
        missionId: string;
        taskId: string;
        commandId: string;
        input?: unknown;
    }): Promise<TaskCommandAcknowledgementType>;
    executeAgentSessionCommand(input: {
        missionId: string;
        sessionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentSessionCommandAcknowledgementType>;
    artifactBody(input: {
        missionId: string;
        id: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<ArtifactBodyType>;
    commandArtifactBody(input: {
        missionId: string;
        id: string;
        body: ArtifactBodyType;
    }): Promise<ArtifactCommandAcknowledgementType>;
};

export type MissionDependencies = {
    snapshot: MissionSnapshotType;
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
        getMissionControlView: async ({ missionId, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission control view queries require a missionId.');
            return MissionControlViewSnapshotSchema.parse(await queryRemote({
                entity: missionEntityName,
                method: 'readControlView',
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
                method: 'command',
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
                method: 'command',
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
                method: 'command',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    sessionId: normalizedSessionId,
                    commandId: normalizedCommandId,
                    ...(commandInput !== undefined ? { input: commandInput } : {})
                }
            }));
        },
        artifactBody: async ({ missionId, id, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Artifact body queries require missionId and id.');
            const normalizedId = requireNonEmptyValue(id, 'Artifact body queries require missionId and id.');
            return ArtifactBodySchema.parse(await queryRemote({
                entity: artifactEntityName,
                method: 'body',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    id: normalizedId
                }
            }, executionContext));
        },
        commandArtifactBody: async ({ missionId, id, body }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Artifact body commands require missionId and id.');
            const normalizedId = requireNonEmptyValue(id, 'Artifact body commands require missionId and id.');
            return ArtifactCommandAcknowledgementSchema.parse(await commandRemote({
                entity: artifactEntityName,
                method: 'command',
                payload: {
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    id: normalizedId,
                    commandId: ArtifactCommandIds.body,
                    input: body
                }
            }));
        }
    };
}

export class Mission implements EntityModel<MissionSnapshotType> {
    private readonly loadData: MissionDataLoader;
    private readonly commandGateway: MissionCommandGateway;
    private readonly childCommands: MissionChildEntityCommandGateway;
    private snapshotState = $state<MissionSnapshotType | undefined>();
    private controlViewSnapshotState = $state<MissionControlViewSnapshotType | undefined>();
    private worktreePathState = $state<string | undefined>();
    private readonly sessions = new EntityRegistry<string, AgentSessionDataType, AgentSession>();
    private readonly stages = new EntityRegistry<string, StageDataType, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();
    private readonly artifacts = new EntityRegistry<string, ArtifactDataType, Artifact>();

    public constructor(input: MissionDependencies) {
        this.snapshot = input.snapshot;
        this.loadData = input.loadData;
        this.commandGateway = createMissionCommandGateway(input.gatewayDependencies);
        this.childCommands = createMissionChildEntityCommandGateway(input.gatewayDependencies);
        this.applySessionSnapshots(input.snapshot.agentSessions);
        this.applyTaskSnapshots(input.snapshot);
        this.applyStageSnapshots(input.snapshot);
        this.applyArtifactDataFromMission(input.snapshot);
    }

    private get snapshot(): MissionSnapshotType {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Mission snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: MissionSnapshotType) {
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

    public get controlViewSnapshot(): MissionControlViewSnapshotType | undefined {
        const snapshot = $state.snapshot(this.controlViewSnapshotState);
        return snapshot ? structuredClone(snapshot) : undefined;
    }

    public get missionWorktreePath(): string | undefined {
        return this.worktreePathState;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.resolveCommandsForOwner({ entity: 'Mission' });
    }

    public setRouteState(input: {
        controlViewSnapshot?: MissionControlViewSnapshotType;
        worktreePath?: string;
    }): this {
        this.worktreePathState = input.worktreePath?.trim() || undefined;

        if (!input.controlViewSnapshot) {
            this.controlViewSnapshotState = undefined;
            return this;
        }

        return this.applyControlViewSnapshot(input.controlViewSnapshot);
    }

    public async pause(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: MissionCommandIds.pause }));
    }

    public async resume(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: MissionCommandIds.resume }));
    }

    public async restartQueue(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: MissionCommandIds.restartQueue }));
    }

    public async deliver(): Promise<this> {
        return this.runCommandAndRefresh(this.commandGateway.executeMissionCommand({ missionId: this.missionId, commandId: MissionCommandIds.deliver }));
    }

    public async getControlViewSnapshot(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionControlViewSnapshotType> {
        const snapshot = await this.commandGateway.getMissionControlView({
            missionId: this.missionId,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
        this.applyControlViewSnapshot(snapshot);
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
    } = {}): Promise<MissionDocumentSnapshotType> {
        return this.commandGateway.readMissionDocument({
            missionId: this.missionId,
            path,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public async writeDocument(
        path: string,
        content: string
    ): Promise<MissionDocumentSnapshotType> {
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

    public getArtifact(id: string): Artifact | undefined {
        return this.artifacts.get(id);
    }

    public async refresh(): Promise<this> {
        this.applySnapshot(await this.loadData(this.missionId));
        return this;
    }

    public updateFromData(snapshot: MissionSnapshotType): this {
        this.snapshot = snapshot;
        this.applySessionSnapshots(snapshot.agentSessions);
        this.applyTaskSnapshots(snapshot);
        this.applyStageSnapshots(snapshot);
        this.applyArtifactDataFromMission(snapshot);
        return this;
    }

    public applyMissionStatus(status: MissionStatusSnapshotType): this {
        const controlViewSnapshot = this.controlViewSnapshot;
        if (!controlViewSnapshot) {
            return this;
        }

        return this.applyControlViewSnapshot({
            ...controlViewSnapshot,
            status: structuredClone(status)
        });
    }

    public applyMissionSnapshot(snapshot: MissionSnapshotType): this {
        return this.applySnapshot(snapshot);
    }

    public applyStageData(data: StageDataType): this {
        const nextStages = upsertById(
            this.stages.values().map((stage) => stage.toData()),
            data,
            (stage) => stage.stageId
        );

        this.applyStageSnapshotsFromStages(nextStages);
        this.applyTaskSnapshotsForStage(data);
        this.applyArtifactDataForStage(data);
        this.updateControlViewStageData(data);
        return this;
    }

    public applyTaskData(data: TaskDataType): this {
        this.applyTaskDataToRegistry(data);
        this.updateControlViewTaskData(data);
        return this;
    }

    public applyArtifactData(data: ArtifactDataType): this {
        this.applyArtifactControlViewData(data);
        this.updateControlViewArtifactData(data);
        return this;
    }

    public applyControlViewSnapshot(snapshot: MissionControlViewSnapshotType): this {
        this.controlViewSnapshotState = structuredClone(snapshot);

        const stageSnapshots = snapshot.workflow?.stages ?? snapshot.status?.workflow?.stages;
        if (stageSnapshots) {
            this.applyTaskSnapshotsFromStages(stageSnapshots);
            this.applyStageSnapshotsFromStages(stageSnapshots);
        }

        const artifactSnapshots = snapshot.status?.artifacts
            ?? stageSnapshots?.flatMap((stage) => stage.artifacts);
        if (artifactSnapshots) {
            this.applyArtifactDataList(artifactSnapshots);
        }

        return this;
    }

    public applyAgentSessionData(data: AgentSessionDataType): this {
        const nextSessions = [
            ...this.sessions
                .values()
                .map((session) => session.toData())
                .filter((session) => session.sessionId !== data.sessionId),
            data
        ];

        this.applySessionSnapshots(nextSessions);
        return this;
    }

    public applySnapshot(snapshot: MissionSnapshotType): this {
        return this.updateFromData(snapshot);
    }

    public toData(): MissionSnapshotType {
        return {
            ...structuredClone($state.snapshot(this.snapshot)),
            agentSessions: this.listSessions().map((session) => session.toData())
        };
    }

    public toJSON(): MissionSnapshotType {
        return this.toData();
    }

    private applySessionSnapshots(sessionSnapshots: AgentSessionDataType[]): void {
        this.sessions.reconcile(
            sessionSnapshots,
            (sessionSnapshot) => sessionSnapshot.sessionId,
            (sessionSnapshot) => new AgentSession(sessionSnapshot, {
                resolveCommands: (sessionId) => this.resolveCommandsForOwner({ entity: 'AgentSession', sessionId }),
                executeCommand: async (sessionId, commandId, input) => {
                    await this.childCommands.executeAgentSessionCommand({
                        missionId: this.missionId,
                        sessionId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyTaskSnapshots(snapshot: MissionSnapshotType): void {
        this.applyTaskSnapshotsFromStages(snapshot.stages);
    }

    private applyTaskSnapshotsFromStages(stages: StageDataType[]): void {
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
                resolveCommands: (taskId) => this.resolveCommandsForOwner({ entity: 'Task', taskId }),
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

    private applyTaskSnapshotsForStage(stage: StageDataType): void {
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

    private applyTaskDataToRegistry(task: TaskDataType): void {
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
                resolveCommands: (taskId) => this.resolveCommandsForOwner({ entity: 'Task', taskId }),
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

    private applyStageSnapshots(snapshot: MissionSnapshotType): void {
        this.applyStageSnapshotsFromStages(snapshot.stages);
    }

    private applyStageSnapshotsFromStages(stages: StageDataType[]): void {
        this.stages.reconcile(
            stages,
            (stage) => stage.stageId,
            (stage) => new Stage(stage, {
                resolveCommands: (stageId) => this.resolveCommandsForOwner({ entity: 'Stage', stageId }),
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

    private applyArtifactDataFromMission(snapshot: MissionSnapshotType): void {
        this.applyArtifactDataList(snapshot.artifacts);
    }

    private applyArtifactDataList(artifacts: ArtifactDataType[]): void {
        this.reconcileArtifactData(artifacts);
    }

    private resolveCommandsForOwner(owner: MissionCommandOwnerType): EntityCommandDescriptorType[] {
        const commandView = this.snapshot.commandView;
        if (!commandView) {
            return [];
        }
        return commandView.commands
            .filter((candidate) => matchesCommandOwner(candidate.owner, owner))
            .map((candidate) => structuredClone($state.snapshot(candidate.command)));
    }

    private applyArtifactDataForStage(stage: StageDataType): void {
        const artifactsData = [
            ...this.artifacts
                .values()
                .map((artifact) => artifact.toData())
                .filter((artifact) => artifact.stageId !== stage.stageId),
            ...stage.artifacts
        ];

        this.reconcileArtifactData(artifactsData);
    }

    private applyArtifactControlViewData(data: ArtifactDataType): void {
        const artifactsData = upsertById(
            this.artifacts.values().map((artifact) => artifact.toData()),
            data,
            (artifact) => artifact.id
        );

        this.reconcileArtifactData(artifactsData);
    }

    private reconcileArtifactData(artifactsData: ArtifactDataType[]): void {
        this.artifacts.reconcile(
            artifactsData,
            (artifactData) => artifactData.id,
            (artifactData) => this.createArtifactEntity(artifactData)
        );
    }

    private updateControlViewStageData(data: StageDataType): void {
        this.updateControlViewWorkflowStages((stages) => upsertById(stages, data, (stage) => stage.stageId));
    }

    private updateControlViewTaskData(data: TaskDataType): void {
        this.updateControlViewWorkflowStages((stages) => stages.map((stage) => {
            if (stage.stageId !== data.stageId) {
                return {
                    ...stage,
                    tasks: stage.tasks.filter((task) => task.taskId !== data.taskId)
                };
            }

            return {
                ...stage,
                tasks: upsertById(stage.tasks, data, (task) => task.taskId)
            };
        }));
    }

    private updateControlViewArtifactData(data: ArtifactDataType): void {
        const controlViewSnapshot = this.controlViewSnapshot;
        if (!controlViewSnapshot) {
            return;
        }

        const statusArtifacts = controlViewSnapshot.status?.artifacts;
        this.applyControlViewSnapshot({
            ...controlViewSnapshot,
            ...(controlViewSnapshot.status
                ? {
                    status: {
                        ...controlViewSnapshot.status,
                        artifacts: statusArtifacts
                            ? upsertById(statusArtifacts, data, (artifact) => artifact.id)
                            : [data]
                    }
                }
                : {})
        });
    }

    private updateControlViewWorkflowStages(
        updateStages: (stages: StageDataType[]) => StageDataType[]
    ): void {
        const controlViewSnapshot = this.controlViewSnapshot;
        if (!controlViewSnapshot) {
            return;
        }

        const hasWorkflowStages = controlViewSnapshot.workflow?.stages !== undefined;
        const hasStatusWorkflowStages = controlViewSnapshot.status?.workflow?.stages !== undefined;
        if (!hasWorkflowStages && !hasStatusWorkflowStages) {
            return;
        }

        this.applyControlViewSnapshot({
            ...controlViewSnapshot,
            ...(controlViewSnapshot.workflow && hasWorkflowStages
                ? {
                    workflow: {
                        ...controlViewSnapshot.workflow,
                        stages: updateStages(controlViewSnapshot.workflow.stages as StageDataType[])
                    }
                }
                : {}),
            ...(controlViewSnapshot.status?.workflow && hasStatusWorkflowStages
                ? {
                    status: {
                        ...controlViewSnapshot.status,
                        workflow: {
                            ...controlViewSnapshot.status.workflow,
                            stages: updateStages(controlViewSnapshot.status.workflow.stages as StageDataType[])
                        }
                    }
                }
                : {})
        });
    }

    private createArtifactEntity(data: ArtifactDataType): Artifact {
        return new Artifact(data, {
            body: async (id, input) => {
                return this.childCommands.artifactBody({
                    missionId: this.missionId,
                    id,
                    ...(input?.executionContext ? { executionContext: input.executionContext } : {})
                });
            },
            commandBody: async (id, body) => {
                return this.childCommands.commandArtifactBody({
                    missionId: this.missionId,
                    id,
                    body
                });
            }
        });
    }

    private async runCommandAndRefresh(command: Promise<MissionCommandAcknowledgementType>): Promise<this> {
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

function matchesCommandOwner(candidate: MissionCommandOwnerType, owner: MissionCommandOwnerType): boolean {
    if (candidate.entity !== owner.entity) {
        return false;
    }
    if (candidate.entity === 'Stage' && owner.entity === 'Stage') {
        return candidate.stageId === owner.stageId;
    }
    if (candidate.entity === 'Task' && owner.entity === 'Task') {
        return candidate.taskId === owner.taskId;
    }
    if (candidate.entity === 'AgentSession' && owner.entity === 'AgentSession') {
        return candidate.sessionId === owner.sessionId;
    }
    return candidate.entity === 'Mission';
}

function sendMissionCommand(
    commandRemote: EntityCommandExecutor,
    input: {
        missionId: string;
        commandId: string;
        input?: unknown;
    },
    repositoryRootPath?: string
): Promise<MissionCommandAcknowledgementType> {
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
