// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type {
    AgentCommand as AgentCommand,
    AgentPrompt as AgentPrompt,
    AgentSession as AgentSessionSnapshot,
    Artifact as ArtifactRecord,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/airport/runtime';
import type {
    OperatorActionExecutionStep,
    OperatorActionListSnapshot,
    OperatorActionQueryContext,
    OperatorStatus
} from '@flying-pillow/mission-core/types.js';
import { AgentSession } from '$lib/components/entities/AgentSession/AgentSession.svelte.js';
import {
    Artifact,
    type ArtifactDocumentPayload as MissionDocumentPayload,
    type ArtifactSnapshot
} from '$lib/components/entities/Artifact/Artifact.svelte.js';
import { EntityRegistry, type EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Stage, type StageSnapshot } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { MissionControlSnapshot } from '$lib/types/mission-control';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    Task,
    type TaskSnapshot,
    type TaskStartOptions
} from '$lib/components/entities/Task/Task.svelte.js';

export type MissionSnapshotLoader = (missionId: string) => Promise<MissionRuntimeSnapshot>;

export type MissionCommandGateway = {
    pauseMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    resumeMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    panicMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    clearMissionPanic(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    restartMissionQueue(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    deliverMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    startTask(input: {
        missionId: string;
        taskId: string;
        terminalSessionName?: string;
    }): Promise<MissionRuntimeSnapshot>;
    completeTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshot>;
    reopenTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshot>;
    completeSession(input: {
        missionId: string;
        sessionId: string;
    }): Promise<MissionRuntimeSnapshot>;
    cancelSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshot>;
    terminateSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshot>;
    sendSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<MissionRuntimeSnapshot>;
    sendSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
    }): Promise<MissionRuntimeSnapshot>;
    getMissionControl(input: {
        missionId: string;
    }): Promise<MissionControlSnapshot>;
    getMissionActions(input: {
        missionId: string;
        context?: OperatorActionQueryContext;
    }): Promise<OperatorActionListSnapshot>;
    executeMissionAction(input: {
        missionId: string;
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<OperatorStatus>;
    readMissionDocument(input: {
        missionId: string;
        path: string;
    }): Promise<MissionDocumentPayload>;
    writeMissionDocument(input: {
        missionId: string;
        path: string;
        content: string;
    }): Promise<MissionDocumentPayload>;
    getMissionWorktree(input: {
        missionId: string;
    }): Promise<MissionFileTreeResponse>;
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
    startTask: async () => {
        throw new Error('Mission task commands are unavailable in this client context.');
    },
    completeTask: async () => {
        throw new Error('Mission task commands are unavailable in this client context.');
    },
    reopenTask: async () => {
        throw new Error('Mission task commands are unavailable in this client context.');
    },
    completeSession: async () => {
        throw new Error('Mission session commands are unavailable in this client context.');
    },
    cancelSession: async () => {
        throw new Error('Mission session commands are unavailable in this client context.');
    },
    terminateSession: async () => {
        throw new Error('Mission session commands are unavailable in this client context.');
    },
    sendSessionPrompt: async () => {
        throw new Error('Mission session commands are unavailable in this client context.');
    },
    sendSessionCommand: async () => {
        throw new Error('Mission session commands are unavailable in this client context.');
    },
    getMissionControl: async () => {
        throw new Error('Mission control queries are unavailable in this client context.');
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

export class Mission implements EntityModel<MissionRuntimeSnapshot> {
    private readonly loadSnapshot: MissionSnapshotLoader;
    private readonly commands: MissionCommandGateway;
    private snapshotState = $state<MissionRuntimeSnapshot | undefined>();
    private controlSnapshotState = $state<MissionControlSnapshot | undefined>();
    private worktreePathState = $state<string | undefined>();
    private readonly sessions = new EntityRegistry<string, AgentSessionSnapshot, AgentSession>();
    private readonly stages = new EntityRegistry<string, StageSnapshot, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();
    private readonly artifacts = new EntityRegistry<string, ArtifactSnapshot, Artifact>();

    public constructor(
        snapshot: MissionRuntimeSnapshot,
        loadSnapshot: MissionSnapshotLoader,
        commands: MissionCommandGateway = unavailableMissionCommands
    ) {
        this.snapshot = snapshot;
        this.loadSnapshot = loadSnapshot;
        this.commands = commands;
        this.applySessionSnapshots(snapshot.sessions);
        this.applyTaskSnapshots(snapshot);
        this.applyStageSnapshots(snapshot);
        this.applyArtifactSnapshots(snapshot);
    }

    private get snapshot(): MissionRuntimeSnapshot {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Mission snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: MissionRuntimeSnapshot) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get missionId(): string {
        return this.snapshot.missionId;
    }

    public get id(): string {
        return this.missionId;
    }

    public get operationalMode(): string | undefined {
        return this.snapshot.status.operationalMode;
    }

    public get workflowLifecycle(): string | undefined {
        return this.snapshot.status.workflow?.lifecycle;
    }

    public get workflowUpdatedAt(): string | undefined {
        return this.snapshot.status.workflow?.updatedAt;
    }

    public get controlSnapshot(): MissionControlSnapshot | undefined {
        const snapshot = $state.snapshot(this.controlSnapshotState);
        return snapshot ? structuredClone(snapshot) : undefined;
    }

    public get missionWorktreePath(): string | undefined {
        return this.worktreePathState;
    }

    public setRouteState(input: {
        controlSnapshot?: MissionControlSnapshot;
        worktreePath?: string;
    }): this {
        this.worktreePathState = input.worktreePath?.trim() || undefined;

        if (!input.controlSnapshot) {
            this.controlSnapshotState = undefined;
            return this;
        }

        this.controlSnapshotState = structuredClone(input.controlSnapshot);
        this.applySnapshot(input.controlSnapshot.missionRuntime);
        return this;
    }

    public async pause(): Promise<this> {
        this.applySnapshot(await this.commands.pauseMission({ missionId: this.missionId }));
        return this;
    }

    public async resume(): Promise<this> {
        this.applySnapshot(await this.commands.resumeMission({ missionId: this.missionId }));
        return this;
    }

    public async panic(): Promise<this> {
        this.applySnapshot(await this.commands.panicMission({ missionId: this.missionId }));
        return this;
    }

    public async clearPanic(): Promise<this> {
        this.applySnapshot(await this.commands.clearMissionPanic({ missionId: this.missionId }));
        return this;
    }

    public async restartQueue(): Promise<this> {
        this.applySnapshot(await this.commands.restartMissionQueue({ missionId: this.missionId }));
        return this;
    }

    public async deliver(): Promise<this> {
        this.applySnapshot(await this.commands.deliverMission({ missionId: this.missionId }));
        return this;
    }

    public async getControlSnapshot(): Promise<MissionControlSnapshot> {
        const snapshot = await this.commands.getMissionControl({
            missionId: this.missionId
        });
        this.setRouteState({
            controlSnapshot: snapshot,
            worktreePath: this.worktreePathState
        });
        return snapshot;
    }

    public async listAvailableActions(
        context?: OperatorActionQueryContext
    ): Promise<OperatorActionListSnapshot> {
        return this.commands.getMissionActions({
            missionId: this.missionId,
            ...(context ? { context } : {})
        });
    }

    public async executeAction(input: {
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
    }): Promise<OperatorStatus> {
        return this.commands.executeMissionAction({
            missionId: this.missionId,
            actionId: input.actionId,
            ...(input.steps ? { steps: input.steps } : {}),
            ...(input.terminalSessionName?.trim()
                ? { terminalSessionName: input.terminalSessionName.trim() }
                : {})
        });
    }

    public async readDocument(path: string): Promise<MissionDocumentPayload> {
        return this.commands.readMissionDocument({
            missionId: this.missionId,
            path
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

    public async getWorktree(): Promise<MissionFileTreeResponse> {
        return this.commands.getMissionWorktree({
            missionId: this.missionId
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

    public updateFromSnapshot(snapshot: MissionRuntimeSnapshot): this {
        this.snapshot = snapshot;
        const controlSnapshot = this.controlSnapshot;
        if (controlSnapshot) {
            this.controlSnapshotState = {
                ...controlSnapshot,
                missionRuntime: structuredClone(snapshot)
            };
        }
        this.applySessionSnapshots(snapshot.sessions);
        this.applyTaskSnapshots(snapshot);
        this.applyStageSnapshots(snapshot);
        this.applyArtifactSnapshots(snapshot);
        return this;
    }

    public applyOperatorStatus(status: OperatorStatus): this {
        const controlSnapshot = this.controlSnapshot;
        if (!controlSnapshot) {
            return this;
        }

        this.controlSnapshotState = {
            ...controlSnapshot,
            operatorStatus: structuredClone(status)
        };
        return this;
    }

    public applySnapshot(snapshot: MissionRuntimeSnapshot): this {
        return this.updateFromSnapshot(snapshot);
    }

    public toSnapshot(): MissionRuntimeSnapshot {
        return {
            ...structuredClone($state.snapshot(this.snapshot)),
            sessions: this.listSessions().map((session) => session.toSnapshot())
        };
    }

    public toJSON(): MissionRuntimeSnapshot {
        return this.toSnapshot();
    }

    private applySessionSnapshots(sessionSnapshots: AgentSessionSnapshot[]): void {
        this.sessions.reconcile(
            sessionSnapshots,
            (sessionSnapshot) => sessionSnapshot.sessionId,
            (sessionSnapshot) => new AgentSession(sessionSnapshot, {
                completeSession: async (sessionId) => {
                    this.applySnapshot(await this.commands.completeSession({
                        missionId: this.missionId,
                        sessionId
                    }));
                },
                cancelSession: async (sessionId, reason) => {
                    this.applySnapshot(await this.commands.cancelSession({
                        missionId: this.missionId,
                        sessionId,
                        ...(reason?.trim() ? { reason: reason.trim() } : {})
                    }));
                },
                terminateSession: async (sessionId, reason) => {
                    this.applySnapshot(await this.commands.terminateSession({
                        missionId: this.missionId,
                        sessionId,
                        ...(reason?.trim() ? { reason: reason.trim() } : {})
                    }));
                },
                sendSessionPrompt: async (sessionId, prompt) => {
                    this.applySnapshot(await this.commands.sendSessionPrompt({
                        missionId: this.missionId,
                        sessionId,
                        prompt
                    }));
                },
                sendSessionCommand: async (sessionId, command) => {
                    this.applySnapshot(await this.commands.sendSessionCommand({
                        missionId: this.missionId,
                        sessionId,
                        command
                    }));
                }
            })
        );
    }

    private applyTaskSnapshots(snapshot: MissionRuntimeSnapshot): void {
        const taskSnapshots: TaskSnapshot[] = (snapshot.status.workflow?.stages ?? []).flatMap((stage) =>
            stage.tasks.map((task) => ({
                stageId: stage.stageId,
                task
            }))
        );

        this.tasks.reconcile(
            taskSnapshots,
            (taskSnapshot) => taskSnapshot.task.taskId,
            (taskSnapshot) => new Task(taskSnapshot, {
                startTask: async (taskId, options: TaskStartOptions = {}) => {
                    this.applySnapshot(await this.commands.startTask({
                        missionId: this.missionId,
                        taskId,
                        ...(options.terminalSessionName?.trim()
                            ? { terminalSessionName: options.terminalSessionName.trim() }
                            : {})
                    }));
                },
                completeTask: async (taskId) => {
                    this.applySnapshot(await this.commands.completeTask({
                        missionId: this.missionId,
                        taskId
                    }));
                },
                reopenTask: async (taskId) => {
                    this.applySnapshot(await this.commands.reopenTask({
                        missionId: this.missionId,
                        taskId
                    }));
                }
            })
        );
    }

    private applyStageSnapshots(snapshot: MissionRuntimeSnapshot): void {
        this.stages.reconcile(
            snapshot.status.workflow?.stages ?? [],
            (stage) => stage.stageId,
            (stage) => new Stage(stage, (taskId) => this.tasks.get(taskId))
        );
    }

    private applyArtifactSnapshots(snapshot: MissionRuntimeSnapshot): void {
        const artifactSnapshots: ArtifactSnapshot[] = (snapshot.status.workflow?.stages ?? []).flatMap((stage) => {
            const stageArtifacts = stage.artifacts.map((artifact) => ({
                filePath: artifact.path,
                label: artifact.label,
                stageId: stage.stageId
            }));
            const taskArtifacts = stage.tasks.flatMap((task) =>
                task.artifacts.map((artifact: ArtifactRecord) => ({
                    filePath: artifact.path,
                    label: artifact.label,
                    stageId: stage.stageId,
                    taskId: task.taskId
                }))
            );

            return [...stageArtifacts, ...taskArtifacts];
        });

        this.artifacts.reconcile(
            artifactSnapshots,
            (artifactSnapshot) => artifactSnapshot.filePath,
            (artifactSnapshot) => this.createArtifactEntity(artifactSnapshot)
        );
    }

    private createArtifactEntity(snapshot: ArtifactSnapshot): Artifact {
        return new Artifact(snapshot, {
            readArtifact: async (filePath) => {
                return this.commands.readMissionDocument({
                    missionId: this.missionId,
                    path: filePath
                });
            },
            writeArtifact: async (filePath, content) => {
                return this.commands.writeMissionDocument({
                    missionId: this.missionId,
                    path: filePath,
                    content
                });
            }
        });
    }
}
