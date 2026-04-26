// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type {
    AgentSessionCommandAcknowledgement,
    AgentSessionCommandListSnapshot,
    ArtifactCommandAcknowledgement,
    ArtifactCommandListSnapshot,
    EntityCommandDescriptor,
    MissionAgentCommand as AgentCommand,
    MissionAgentPrompt as AgentPrompt,
    MissionActionListSnapshot,
    MissionAgentSessionSnapshot as AgentSessionSnapshot,
    MissionActionDescriptor,
    MissionArtifactSnapshot,
    MissionCommandAcknowledgement,
    MissionProjectionSnapshot,
    MissionSnapshot,
    MissionStageSnapshot,
    MissionTaskSnapshot,
    StageCommandAcknowledgement,
    StageCommandListSnapshot,
    TaskCommandAcknowledgement,
    TaskCommandListSnapshot
} from '@flying-pillow/mission-core/schemas';
import type {
    OperatorActionExecutionStep,
    MissionActionQueryContext,
    MissionStatusSnapshot
} from '@flying-pillow/mission-core/schemas';
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

export type MissionSnapshotLoader = (missionId: string) => Promise<MissionSnapshot>;
type MissionQueryExecutionContext = 'event' | 'render';
export type MissionDocumentPayload = ArtifactDocumentPayload;

export type MissionCommandGateway = {
    pauseMission(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    resumeMission(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    panicMission(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    clearMissionPanic(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    restartMissionQueue(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    deliverMission(input: {
        missionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    getMissionProjection(input: {
        missionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionProjectionSnapshot>;
    getMissionActions(input: {
        missionId: string;
        context?: MissionActionQueryContext;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<MissionActionListSnapshot>;
    executeMissionAction(input: {
        missionId: string;
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<MissionCommandAcknowledgement>;
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

export type MissionChildEntityCommandGateway = {
    listStageCommands(input: {
        missionId: string;
        stageId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<StageCommandListSnapshot>;
    executeStageCommand(input: {
        missionId: string;
        stageId: string;
        commandId: string;
        input?: unknown;
    }): Promise<StageCommandAcknowledgement>;
    listTaskCommands(input: {
        missionId: string;
        taskId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<TaskCommandListSnapshot>;
    executeTaskCommand(input: {
        missionId: string;
        taskId: string;
        commandId: string;
        input?: unknown;
    }): Promise<TaskCommandAcknowledgement>;
    listArtifactCommands(input: {
        missionId: string;
        artifactId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<ArtifactCommandListSnapshot>;
    executeArtifactCommand(input: {
        missionId: string;
        artifactId: string;
        commandId: string;
        input?: unknown;
    }): Promise<ArtifactCommandAcknowledgement>;
    listAgentSessionCommands(input: {
        missionId: string;
        sessionId: string;
        executionContext?: MissionQueryExecutionContext;
    }): Promise<AgentSessionCommandListSnapshot>;
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

const unavailableMissionCommands: MissionCommandGateway = {
    pauseMission: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    resumeMission: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    panicMission: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    clearMissionPanic: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    restartMissionQueue: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    deliverMission: async () => {
        throw new Error('Mission commands are unavailable in this client context.');
    },
    getMissionProjection: async () => {
        throw new Error('Mission projection queries are unavailable in this client context.');
    },
    getMissionActions: async () => {
        throw new Error('Mission action queries are unavailable in this client context.');
    },
    executeMissionAction: async () => {
        throw new Error('Mission action commands are unavailable in this client context.');
    },
    readMissionDocument: async () => {
        throw new Error('Mission document queries are unavailable in this client context.');
    },
    writeMissionDocument: async () => {
        throw new Error('Mission document commands are unavailable in this client context.');
    },
    getMissionWorktree: async () => {
        throw new Error('Mission worktree queries are unavailable in this client context.');
    }
};

const unavailableChildEntityCommands: MissionChildEntityCommandGateway = {
    listStageCommands: async () => {
        throw new Error('Stage command queries are unavailable in this client context.');
    },
    executeStageCommand: async () => {
        throw new Error('Stage commands are unavailable in this client context.');
    },
    listTaskCommands: async () => {
        throw new Error('Task command queries are unavailable in this client context.');
    },
    executeTaskCommand: async () => {
        throw new Error('Task commands are unavailable in this client context.');
    },
    listArtifactCommands: async () => {
        throw new Error('Artifact command queries are unavailable in this client context.');
    },
    executeArtifactCommand: async () => {
        throw new Error('Artifact commands are unavailable in this client context.');
    },
    listAgentSessionCommands: async () => {
        throw new Error('AgentSession command queries are unavailable in this client context.');
    },
    executeAgentSessionCommand: async () => {
        throw new Error('AgentSession commands are unavailable in this client context.');
    },
    sendAgentSessionPrompt: async () => {
        throw new Error('AgentSession prompt commands are unavailable in this client context.');
    },
    sendAgentSessionCommand: async () => {
        throw new Error('AgentSession terminal commands are unavailable in this client context.');
    },
    readArtifactDocument: async () => {
        throw new Error('Artifact document queries are unavailable in this client context.');
    },
    writeArtifactDocument: async () => {
        throw new Error('Artifact document commands are unavailable in this client context.');
    }
};

export class Mission implements EntityModel<MissionSnapshot> {
    private readonly loadSnapshot: MissionSnapshotLoader;
    private readonly commands: MissionCommandGateway;
    private readonly childCommands: MissionChildEntityCommandGateway;
    private snapshotState = $state<MissionSnapshot | undefined>();
    private projectionSnapshotState = $state<MissionProjectionSnapshot | undefined>();
    private worktreePathState = $state<string | undefined>();
    private readonly sessions = new EntityRegistry<string, AgentSessionSnapshot, AgentSession>();
    private readonly stages = new EntityRegistry<string, StageSnapshot, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();
    private readonly artifacts = new EntityRegistry<string, ArtifactSnapshot, Artifact>();

    public constructor(
        snapshot: MissionSnapshot,
        loadSnapshot: MissionSnapshotLoader,
        commands: MissionCommandGateway = unavailableMissionCommands,
        childCommands: MissionChildEntityCommandGateway = unavailableChildEntityCommands
    ) {
        this.snapshot = snapshot;
        this.loadSnapshot = loadSnapshot;
        this.commands = commands;
        this.childCommands = childCommands;
        this.applySessionSnapshots(snapshot.agentSessions);
        this.applyTaskSnapshots(snapshot);
        this.applyStageSnapshots(snapshot);
        this.applyArtifactSnapshots(snapshot);
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
        return this.runCommandAndRefresh(this.commands.pauseMission({ missionId: this.missionId }));
    }

    public async resume(): Promise<this> {
        return this.runCommandAndRefresh(this.commands.resumeMission({ missionId: this.missionId }));
    }

    public async panic(): Promise<this> {
        return this.runCommandAndRefresh(this.commands.panicMission({ missionId: this.missionId }));
    }

    public async clearPanic(): Promise<this> {
        return this.runCommandAndRefresh(this.commands.clearMissionPanic({ missionId: this.missionId }));
    }

    public async restartQueue(): Promise<this> {
        return this.runCommandAndRefresh(this.commands.restartMissionQueue({ missionId: this.missionId }));
    }

    public async deliver(): Promise<this> {
        return this.runCommandAndRefresh(this.commands.deliverMission({ missionId: this.missionId }));
    }

    public async getProjectionSnapshot(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionProjectionSnapshot> {
        const snapshot = await this.commands.getMissionProjection({
            missionId: this.missionId,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
        this.applyProjectionSnapshot(snapshot);
        return snapshot;
    }

    public async listAvailableActions(
        context?: MissionActionQueryContext,
        input: { executionContext?: MissionQueryExecutionContext } = {}
    ): Promise<MissionActionListSnapshot> {
        return this.commands.getMissionActions({
            missionId: this.missionId,
            ...(context ? { context } : {}),
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public async listCommands(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<EntityCommandDescriptor[]> {
        const snapshot = await this.listAvailableActions(undefined, input);
        return snapshot.actions
            .filter(isMissionScopedAction)
            .map(toMissionCommandDescriptor);
    }

    public async executeAction(input: {
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<void> {
        await this.commands.executeMissionAction({
            missionId: this.missionId,
            actionId: input.actionId,
            ...(input.steps ? { steps: input.steps } : {}),
            ...(input.terminalSessionName?.trim()
                ? { terminalSessionName: input.terminalSessionName.trim() }
                : {})
        });
        await this.refresh();
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        const steps = Array.isArray(input) ? input as OperatorActionExecutionStep[] : undefined;
        await this.executeAction({
            actionId: commandId,
            ...(steps ? { steps } : {})
        });
    }

    public async readDocument(path: string, input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionDocumentPayload> {
        return this.commands.readMissionDocument({
            missionId: this.missionId,
            path,
            ...(input.executionContext ? { executionContext: input.executionContext } : {})
        });
    }

    public async writeDocument(
        path: string,
        content: string
    ): Promise<MissionDocumentPayload> {
        return this.commands.writeMissionDocument({
            missionId: this.missionId,
            path,
            content
        });
    }

    public async getWorktree(input: {
        executionContext?: MissionQueryExecutionContext;
    } = {}): Promise<MissionFileTreeResponse> {
        return this.commands.getMissionWorktree({
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
        const snapshot: ArtifactSnapshot = {
            artifactId: input.filePath,
            filePath: input.filePath,
            ...(input.label?.trim() ? { label: input.label.trim() } : {}),
            ...(input.stageId?.trim() ? { stageId: input.stageId.trim() } : {}),
            ...(input.taskId?.trim() ? { taskId: input.taskId.trim() } : {})
        };
        const knownArtifacts = this.artifacts.values().map((artifact) => artifact.toSnapshot());
        const nextArtifacts = knownArtifacts.some((artifact) => artifact.filePath === snapshot.filePath)
            ? knownArtifacts.map((artifact) =>
                artifact.filePath === snapshot.filePath
                    ? {
                        ...artifact,
                        ...snapshot
                    }
                    : artifact
            )
            : [...knownArtifacts, snapshot];

        this.artifacts.reconcile(
            nextArtifacts,
            (artifactSnapshot) => artifactSnapshot.filePath,
            (artifactSnapshot) => this.createArtifactEntity(artifactSnapshot)
        );

        return this.getArtifact(snapshot.filePath) as Artifact;
    }

    public async refresh(): Promise<this> {
        this.applySnapshot(await this.loadSnapshot(this.missionId));
        return this;
    }

    public updateFromSnapshot(snapshot: MissionSnapshot): this {
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
            this.stages.values().map((stage) => stage.toSnapshot()),
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
                .map((session) => session.toSnapshot())
                .filter((session) => session.sessionId !== snapshot.sessionId),
            snapshot
        ];

        this.applySessionSnapshots(nextSessions);
        return this;
    }

    public applySnapshot(snapshot: MissionSnapshot): this {
        return this.updateFromSnapshot(snapshot);
    }

    public toSnapshot(): MissionSnapshot {
        return {
            ...structuredClone($state.snapshot(this.snapshot)),
            agentSessions: this.listSessions().map((session) => session.toSnapshot())
        };
    }

    public toJSON(): MissionSnapshot {
        return this.toSnapshot();
    }

    private applySessionSnapshots(sessionSnapshots: AgentSessionSnapshot[]): void {
        this.sessions.reconcile(
            sessionSnapshots,
            (sessionSnapshot) => sessionSnapshot.sessionId,
            (sessionSnapshot) => new AgentSession(sessionSnapshot, {
                listSessionCommands: async (sessionId, input = {}) => {
                    return this.childCommands.listAgentSessionCommands({
                        missionId: this.missionId,
                        sessionId,
                        ...(input.executionContext ? { executionContext: input.executionContext } : {})
                    });
                },
                executeSessionCommand: async (sessionId, commandId, input) => {
                    await this.childCommands.executeAgentSessionCommand({
                        missionId: this.missionId,
                        sessionId,
                        commandId,
                        ...(input !== undefined ? { input } : {})
                    });
                    await this.refresh();
                },
                sendSessionPrompt: async (sessionId, prompt) => {
                    await this.childCommands.sendAgentSessionPrompt({
                        missionId: this.missionId,
                        sessionId,
                        prompt
                    });
                    await this.refresh();
                },
                sendSessionCommand: async (sessionId, command) => {
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
                listTaskCommands: async (taskId, input = {}) => {
                    return this.childCommands.listTaskCommands({
                        missionId: this.missionId,
                        taskId,
                        ...(input.executionContext ? { executionContext: input.executionContext } : {})
                    });
                },
                executeTaskCommand: async (taskId, commandId, input) => {
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
                .map((task) => task.toSnapshot())
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
            this.tasks.values().map((knownTask) => knownTask.toSnapshot()),
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
                listTaskCommands: async (taskId, input = {}) => {
                    return this.childCommands.listTaskCommands({
                        missionId: this.missionId,
                        taskId,
                        ...(input.executionContext ? { executionContext: input.executionContext } : {})
                    });
                },
                executeTaskCommand: async (taskId, commandId, input) => {
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
            (stage) => new Stage(stage, (taskId) => this.tasks.get(taskId), {
                listStageCommands: async (stageId, input = {}) => {
                    return this.childCommands.listStageCommands({
                        missionId: this.missionId,
                        stageId,
                        ...(input.executionContext ? { executionContext: input.executionContext } : {})
                    });
                },
                executeStageCommand: async (stageId, commandId, input) => {
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
                .map((artifact) => artifact.toSnapshot())
                .filter((artifact) => artifact.stageId !== stage.stageId),
            ...stage.artifacts.map(toArtifactSnapshot)
        ];

        this.reconcileArtifactSnapshots(artifactSnapshots);
    }

    private applyArtifactProjectionSnapshot(snapshot: MissionArtifactSnapshot): void {
        const artifactSnapshot = toArtifactSnapshot(snapshot);
        const artifactSnapshots = upsertById(
            this.artifacts.values().map((artifact) => artifact.toSnapshot()),
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
            listArtifactCommands: async (artifactId, input = {}) => {
                return this.childCommands.listArtifactCommands({
                    missionId: this.missionId,
                    artifactId,
                    ...(input.executionContext ? { executionContext: input.executionContext } : {})
                });
            },
            executeArtifactCommand: async (artifactId, commandId, input) => {
                await this.childCommands.executeArtifactCommand({
                    missionId: this.missionId,
                    artifactId,
                    commandId,
                    ...(input !== undefined ? { input } : {})
                });
                await this.refresh();
            },
            readArtifact: async (_filePath, input) => {
                return this.childCommands.readArtifactDocument({
                    missionId: this.missionId,
                    artifactId: snapshot.artifactId,
                    ...(input?.executionContext ? { executionContext: input.executionContext } : {})
                });
            },
            writeArtifact: async (_filePath, content) => {
                return this.childCommands.writeArtifactDocument({
                    missionId: this.missionId,
                    artifactId: snapshot.artifactId,
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

function upsertById<T>(snapshots: T[], snapshot: T, selectId: (snapshot: T) => string): T[] {
    const nextId = selectId(snapshot);
    let replaced = false;
    const nextSnapshots = snapshots.map((candidate) => {
        if (selectId(candidate) !== nextId) {
            return candidate;
        }

        replaced = true;
        return snapshot;
    });

    return replaced ? nextSnapshots : [...nextSnapshots, snapshot];
}

function toArtifactSnapshot(artifact: MissionArtifactSnapshot): ArtifactSnapshot {
    return {
        artifactId: artifact.artifactId,
        filePath: artifact.filePath ?? artifact.relativePath ?? artifact.artifactId,
        label: artifact.label,
        ...(artifact.stageId ? { stageId: artifact.stageId } : {}),
        ...(artifact.taskId ? { taskId: artifact.taskId } : {})
    };
}

function toMissionCommandDescriptor(action: MissionActionDescriptor): EntityCommandDescriptor {
    return {
        commandId: action.actionId,
        label: action.label,
        ...(action.description ? { description: action.description } : {}),
        disabled: action.disabled ?? false,
        ...(action.disabledReason ? { disabledReason: action.disabledReason } : {})
    };
}

function isMissionScopedAction(action: MissionActionDescriptor): boolean {
    const target = action.target;
    const targetScope = typeof target === 'object'
        && target !== null
        && !Array.isArray(target)
        && typeof target['scope'] === 'string'
        ? target['scope']
        : undefined;

    return (targetScope ?? action.kind) === 'mission';
}
