// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent executions.
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityInvocation';
import {
    AgentExecutionCommandAcknowledgementSchema,
    type AgentExecutionCommandAcknowledgementType,
    type AgentExecutionDataType
} from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
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
    MissionSchema,
    MissionDocumentSchema,
    MissionControlSchema,
    MissionWorktreeSchema,
    type MissionCommandAcknowledgementType,
    type MissionControlType,
    type MissionType,
    type MissionDocumentType,
    type MissionWorktreeType
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
import { AgentExecution } from '$lib/components/entities/AgentExecution/AgentExecution.svelte.js';
import {
    Artifact
} from '$lib/components/entities/Artifact/Artifact.svelte.js';
import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';
import { EntityRegistry } from '$lib/components/entities/Entity/EntityRegistry.svelte.js';
import { Stage } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    Task,
    type TaskHydratedData
} from '$lib/components/entities/Task/Task.svelte.js';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

export type MissionDataLoader = (missionId: string) => Promise<MissionType>;
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
    getMissionControl(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionControlType>;
    readMissionDocument(input: {
        missionId: string;
        path: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionDocumentType>;
    writeMissionDocument(input: {
        missionId: string;
        path: string;
        content: string;
    }): Promise<MissionDocumentType>;
    getMissionWorktree(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionWorktreeType>;
};

type MissionCommandOwner =
    | { entity: 'Mission' }
    | { entity: 'Stage'; stageId: string }
    | { entity: 'Task'; taskId: string }
    | { entity: 'AgentExecution'; agentExecutionId: string };

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
    executeAgentExecutionCommand(input: {
        ownerId: string;
        agentExecutionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentExecutionCommandAcknowledgementType>;
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
    data: MissionType;
    loadData: MissionDataLoader;
    gatewayDependencies: MissionGatewayDependencies;
};

const missionEntityName = 'Mission';
const stageEntityName = 'Stage';
const taskEntityName = 'Task';
const artifactEntityName = 'Artifact';
const agentExecutionEntityName = 'AgentExecution';

function createMissionCommandGateway(input: MissionGatewayDependencies): MissionCommandGateway {
    const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    const { commandRemote, queryRemote } = input;

    return {
        executeMissionCommand: async ({ missionId, commandId, input: commandInput }) => sendMissionCommand(commandRemote, {
            missionId,
            commandId,
            ...(commandInput !== undefined ? { input: commandInput } : {})
        }, repositoryRootPath),
        getMissionControl: async ({ missionId, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission control view queries require a missionId.');
            return MissionControlSchema.parse(await queryRemote({
                entity: missionEntityName,
                method: 'readControl',
                payload: buildMissionPayload(normalizedMissionId, repositoryRootPath)
            }, executionContext));
        },
        readMissionDocument: async ({ missionId, path, executionContext }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Mission document queries require missionId and path.');
            const normalizedPath = path.trim();
            if (!normalizedPath) {
                throw new Error('Mission document queries require missionId and path.');
            }

            return MissionDocumentSchema.parse(await queryRemote({
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

            return MissionDocumentSchema.parse(await commandRemote({
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
            return MissionWorktreeSchema.parse(await queryRemote({
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
                method: resolveEntityCommandMethod(stageEntityName, normalizedCommandId),
                payload: buildEntityMethodPayload({
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    stageId: normalizedStageId
                }, commandInput)
            }));
        },
        executeTaskCommand: async ({ missionId, taskId, commandId, input: commandInput }) => {
            const normalizedMissionId = requireMissionId(missionId, 'Task commands require missionId, taskId, and commandId.');
            const normalizedTaskId = requireNonEmptyValue(taskId, 'Task commands require missionId, taskId, and commandId.');
            const normalizedCommandId = requireNonEmptyValue(commandId, 'Task commands require missionId, taskId, and commandId.');
            return TaskCommandAcknowledgementSchema.parse(await commandRemote({
                entity: taskEntityName,
                method: resolveEntityCommandMethod(taskEntityName, normalizedCommandId),
                payload: buildEntityMethodPayload({
                    ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
                    taskId: normalizedTaskId
                }, commandInput)
            }));
        },
        executeAgentExecutionCommand: async ({ ownerId, agentExecutionId, commandId, input: commandInput }) => {
            const normalizedOwnerId = requireNonEmptyValue(ownerId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
            const normalizedAgentExecutionId = requireNonEmptyValue(agentExecutionId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
            const normalizedCommandId = requireNonEmptyValue(commandId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
            return AgentExecutionCommandAcknowledgementSchema.parse(await commandRemote({
                entity: agentExecutionEntityName,
                method: 'command',
                payload: {
                    ownerId: normalizedOwnerId,
                    agentExecutionId: normalizedAgentExecutionId,
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

export class Mission extends Entity<MissionType> {
    private readonly loadData: MissionDataLoader;
    private readonly commandGateway: MissionCommandGateway;
    private readonly childCommands: MissionChildEntityCommandGateway;
    private readonly repositoryRootPath: string | undefined;
    private data = $state<MissionType | undefined>();
    private controlDataState = $state<MissionControlType | undefined>();
    private worktreePathState = $state<string | undefined>();
    private readonly terminals = new EntityRegistry<string, AgentExecutionDataType, AgentExecution>();
    private readonly stageRegistry = new EntityRegistry<string, StageDataType, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskHydratedData, Task>();
    private readonly artifacts = new EntityRegistry<string, ArtifactDataType, Artifact>();

    public constructor(input: MissionDependencies) {
        super();
        this.setData(input.data);
        this.loadData = input.loadData;
        this.repositoryRootPath = input.gatewayDependencies.repositoryRootPath?.trim() || undefined;
        this.commandGateway = createMissionCommandGateway(input.gatewayDependencies);
        this.childCommands = createMissionChildEntityCommandGateway(input.gatewayDependencies);
        this.applyAgentExecutionSnapshots(input.data.agentExecutions);
        this.applyTaskSnapshots(input.data);
        this.applyStageSnapshots(input.data);
        this.applyArtifactDataFromMission(input.data);
    }

    private requireData(): MissionType {
        const data = this.data;
        if (!data) {
            throw new Error('Mission data is not initialized.');
        }

        return data;
    }

    private setData(data: MissionType): void {
        this.data = MissionSchema.parse(structuredClone(data));
    }

    public get missionId(): string {
        return this.requireData().missionId;
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

    protected get entityLocator(): Record<string, unknown> {
        return {
            missionId: this.missionId,
            ...(this.repositoryRootPath ? { repositoryRootPath: this.repositoryRootPath } : {})
        };
    }

    public get operationalMode(): string | undefined {
        const data = this.requireData();
        return this.controlDataState?.mission.operationalMode ?? data.operationalMode;
    }

    public get workflowLifecycle(): string | undefined {
        const data = this.requireData();
        return this.controlDataState?.mission.workflow?.lifecycle ?? data.lifecycle;
    }

    public get workflowUpdatedAt(): string | undefined {
        const data = this.requireData();
        return this.controlDataState?.mission.workflow?.updatedAt ?? data.updatedAt;
    }

    public get controlData(): MissionControlType | undefined {
        const data = $state.snapshot(this.controlDataState);
        return data ? structuredClone(data) : undefined;
    }

    public get missionWorktreePath(): string | undefined {
        return this.worktreePathState;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.resolveCommandsForOwner({ entity: 'Mission' });
    }

    public setRouteState(input: {
        controlData?: MissionControlType;
        worktreePath?: string;
    }): this {
        this.worktreePathState = input.worktreePath?.trim() || undefined;

        if (!input.controlData) {
            this.controlDataState = undefined;
            return this;
        }

        return this.applyControlData(input.controlData);
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

    public async getControlData(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionControlType> {
        const data = await this.commandGateway.getMissionControl({
            missionId: this.missionId,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
        this.applyControlData(data);
        return data;
    }

    public async executeCommand<TResult = void>(commandId: string, input?: unknown): Promise<TResult> {
        await this.commandGateway.executeMissionCommand({
            missionId: this.missionId,
            commandId,
            ...(input !== undefined ? { input } : {})
        });
        await this.refresh();
        return undefined as TResult;
    }

    public async readDocument(path: string, input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionDocumentType> {
        return this.commandGateway.readMissionDocument({
            missionId: this.missionId,
            path,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public async writeDocument(
        path: string,
        content: string
    ): Promise<MissionDocumentType> {
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
        return this.stageRegistry.values();
    }

    public get stages(): Stage[] {
        return this.listStages();
    }

    public getStage(stageId: string): Stage | undefined {
        return this.stageRegistry.get(stageId);
    }

    public listExecutions(): AgentExecution[] {
        return this.terminals.values();
    }

    public get agentExecutions(): AgentExecution[] {
        return this.listExecutions();
    }

    public listArtifacts(): Artifact[] {
        return this.artifacts.values();
    }

    public get missionArtifacts(): Artifact[] {
        return this.listArtifacts();
    }

    public listTasks(): Task[] {
        return this.tasks.values();
    }

    public get missionTasks(): Task[] {
        return this.listTasks();
    }

    public getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    public listTasksForStage(stageId: string): Task[] {
        return this.getStage(stageId)?.listTasks() ?? [];
    }

    public getAgentExecution(agentExecutionId: string): AgentExecution | undefined {
        return this.terminals.get(agentExecutionId);
    }

    public getArtifact(id: string): Artifact | undefined {
        return this.artifacts.get(id);
    }

    public async refresh(): Promise<this> {
        this.applyData(await this.loadData(this.missionId));
        return this;
    }

    public updateFromData(data: MissionType): this {
        this.setData(data);
        this.applyAgentExecutionSnapshots(data.agentExecutions);
        this.applyTaskSnapshots(data);
        this.applyStageSnapshots(data);
        this.applyArtifactDataFromMission(data);
        return this;
    }

    public applyMissionStatus(status: MissionType): this {
        const controlData = this.controlData;
        if (!controlData) {
            return this;
        }

        return this.applyControlData({
            ...controlData,
            status: structuredClone(status)
        });
    }

    public applyMissionData(data: MissionType): this {
        return this.applyData(data);
    }

    public applyStageData(data: StageDataType): this {
        const nextStages = upsertById(
            this.stageRegistry.values().map((stage) => stage.toData()),
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

    public applyControlData(data: MissionControlType): this {
        this.controlDataState = structuredClone(data);
        this.updateFromData(data.mission);

        this.applyTaskSnapshotsFromStages(data.mission.stages);
        this.applyStageSnapshotsFromStages(data.mission.stages);
        this.applyArtifactDataList(data.mission.artifacts);
        this.applyAgentExecutionSnapshots(data.mission.agentExecutions);

        return this;
    }

    public applyAgentExecutionData(data: AgentExecutionDataType): this {
        const nextAgentExecutions = [
            ...this.terminals
                .values()
                .map((execution) => execution.toData())
                .filter((execution) => execution.agentExecutionId !== data.agentExecutionId),
            data
        ];

        this.applyAgentExecutionSnapshots(nextAgentExecutions);
        return this;
    }

    public applyData(data: MissionType): this {
        return this.updateFromData(data);
    }

    public toData(): MissionType {
        return {
            ...structuredClone($state.snapshot(this.requireData())),
            tasks: this.listTasks().map((task) => task.toTaskData()),
            agentExecutions: this.listExecutions().map((execution) => execution.toData())
        };
    }

    public toJSON(): MissionType {
        return this.toData();
    }

    private applyAgentExecutionSnapshots(agentExecutionSnapshots: AgentExecutionDataType[]): void {
        this.terminals.reconcile(
            agentExecutionSnapshots,
            (agentExecutionSnapshot) => agentExecutionSnapshot.agentExecutionId,
            (agentExecutionSnapshot) => new AgentExecution(agentExecutionSnapshot, {
                resolveCommands: (agentExecutionId) => this.resolveCommandsForOwner({ entity: 'AgentExecution', agentExecutionId }),
                executeCommand: async (ownerId, agentExecutionId, commandId, input) => {
                    await this.childCommands.executeAgentExecutionCommand({
                        ownerId,
                        agentExecutionId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                }
            })
        );
    }

    private applyTaskSnapshots(data: MissionType): void {
        this.applyTaskSnapshotsFromStages(data.stages);
    }

    private applyTaskSnapshotsFromStages(stages: StageDataType[]): void {
        const taskDataItems: TaskHydratedData[] = stages.flatMap((stage) =>
            stage.tasks.map((task) => ({
                stageId: stage.stageId,
                task
            }))
        );

        this.tasks.reconcile(
            taskDataItems,
            (taskData) => taskData.task.taskId,
            (taskData) => new Task(taskData, {
                resolveCommands: (taskId) => this.resolveCommandsForOwner({ entity: 'Task', taskId }),
                resolveAgentExecution: (taskId) => this.resolvePreferredTaskAgentExecution(taskId),
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
        const taskDataItems = [
            ...this.tasks
                .values()
                .map((task) => task.toData())
                .filter((task) => task.stageId !== stage.stageId),
            ...stage.tasks.map((task) => ({
                stageId: stage.stageId,
                task
            }))
        ];

        this.reconcileTaskData(taskDataItems);
    }

    private applyTaskDataToRegistry(task: TaskDataType): void {
        const nextTaskData: TaskHydratedData = {
            stageId: task.stageId,
            task
        };
        const taskDataItems = upsertById(
            this.tasks.values().map((knownTask) => knownTask.toData()),
            nextTaskData,
            (data) => data.task.taskId
        );

        this.reconcileTaskData(taskDataItems);
    }

    private reconcileTaskData(taskDataItems: TaskHydratedData[]): void {
        this.tasks.reconcile(
            taskDataItems,
            (taskData) => taskData.task.taskId,
            (taskData) => new Task(taskData, {
                resolveCommands: (taskId) => this.resolveCommandsForOwner({ entity: 'Task', taskId }),
                resolveAgentExecution: (taskId) => this.resolvePreferredTaskAgentExecution(taskId),
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

    private applyStageSnapshots(data: MissionType): void {
        this.applyStageSnapshotsFromStages(data.stages);
    }

    private resolvePreferredTaskAgentExecution(taskId: string): AgentExecution | undefined {
        const executions = this.listExecutions().filter((execution) => execution.taskId === taskId);
        return executions.find((execution) => execution.isRunning() && execution.isTerminalBacked())
            ?? executions.find((execution) => execution.isRunning())
            ?? executions.find((execution) => execution.isTerminalBacked())
            ?? executions[0];
    }

    private applyStageSnapshotsFromStages(stages: StageDataType[]): void {
        this.stageRegistry.reconcile(
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

    private applyArtifactDataFromMission(data: MissionType): void {
        this.applyArtifactDataList(data.artifacts);
    }

    private applyArtifactDataList(artifacts: ArtifactDataType[]): void {
        this.reconcileArtifactData(artifacts);
    }

    private resolveCommandsForOwner(owner: MissionCommandOwner): EntityCommandDescriptorType[] {
        if (owner.entity === 'Mission') {
            return structuredClone($state.snapshot(this.controlDataState?.mission.commands ?? []));
        }
        if (owner.entity === 'Stage') {
            const stage = this.controlDataState?.mission.stages.find((candidate) => candidate.stageId === owner.stageId);
            return structuredClone($state.snapshot(stage?.commands ?? []));
        }
        if (owner.entity === 'Task') {
            const task = this.controlDataState?.mission.stages
                .flatMap((stage) => stage.tasks)
                .find((candidate) => candidate.taskId === owner.taskId);
            return structuredClone($state.snapshot(task?.commands ?? []));
        }
        if (owner.entity === 'AgentExecution') {
            return this.getAgentExecution(owner.agentExecutionId)?.commands ?? [];
        }
        return [];
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
        const controlData = this.controlData;
        if (!controlData) {
            return;
        }

        this.applyControlData({
            ...controlData,
            mission: {
                ...controlData.mission,
                artifacts: upsertById(controlData.mission.artifacts, data, (artifact) => artifact.id)
            }
        });
    }

    private updateControlViewWorkflowStages(
        updateStages: (stages: StageDataType[]) => StageDataType[]
    ): void {
        const controlData = this.controlData;
        if (!controlData) {
            return;
        }

        this.applyControlData({
            ...controlData,
            mission: {
                ...controlData.mission,
                stages: updateStages(controlData.mission.stages as StageDataType[])
            }
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
            bodyForRender: (id) => {
                return qry({
                    entity: artifactEntityName,
                    method: 'body',
                    payload: {
                        missionId: this.missionId,
                        id
                    }
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
    const method = resolveMissionCommandMethod(normalizedCommandId);

    return MissionCommandAcknowledgementSchema.parseAsync(commandRemote({
        entity: missionEntityName,
        method,
        payload: {
            ...buildMissionPayload(normalizedMissionId, repositoryRootPath),
            ...(input.input !== undefined ? { input: input.input } : {})
        }
    }));
}

function resolveEntityCommandMethod(entityName: string, commandId: string): string {
    const prefix = `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}.`;
    if (!commandId.startsWith(prefix)) {
        throw new Error(`Command '${commandId}' does not belong to Entity '${entityName}'.`);
    }
    const method = commandId.slice(prefix.length).trim();
    if (!method) {
        throw new Error(`Command '${commandId}' does not include an Entity method.`);
    }
    return method;
}

function buildEntityMethodPayload(locator: Record<string, unknown>, input: unknown): Record<string, unknown> {
    if (input === undefined) {
        return locator;
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {
            ...locator,
            input
        };
    }
    return {
        ...locator,
        ...structuredClone(input as Record<string, unknown>)
    };
}

function resolveMissionCommandMethod(commandId: string): 'pause' | 'resume' | 'restartQueue' | 'deliver' {
    if (commandId === MissionCommandIds.pause) {
        return 'pause';
    }
    if (commandId === MissionCommandIds.resume) {
        return 'resume';
    }
    if (commandId === MissionCommandIds.restartQueue) {
        return 'restartQueue';
    }
    if (commandId === MissionCommandIds.deliver) {
        return 'deliver';
    }
    throw new Error(`Unknown Mission command '${commandId}'.`);
}
