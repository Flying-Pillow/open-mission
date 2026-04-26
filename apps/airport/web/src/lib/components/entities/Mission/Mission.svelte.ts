// /apps/airport/web/src/lib/client/entities/Mission.svelte.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type {
    MissionAgentCommand as AgentCommand,
    MissionAgentPrompt as AgentPrompt,
    MissionActionListSnapshot,
    MissionAgentSessionSnapshot as AgentSessionSnapshot,
    MissionArtifactSnapshot,
    MissionCommandAcknowledgement,
    MissionProjectionSnapshot,
    MissionSnapshot,
    MissionStageSnapshot
} from '@flying-pillow/mission-core/schemas';
import type {
    OperatorActionExecutionStep,
    MissionActionQueryContext,
    MissionStatusSnapshot
} from '@flying-pillow/mission-core/schemas';
import { AgentSession } from '$lib/components/entities/AgentSession/AgentSession.svelte.js';
import {
    Artifact,
    type ArtifactDocumentPayload as MissionDocumentPayload,
    type ArtifactSnapshot
} from '$lib/components/entities/Artifact/Artifact.svelte.js';
import { EntityRegistry, type EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Stage, type StageSnapshot } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { MissionFileTreeResponse } from '$lib/types/mission-file-tree';
import {
    Task,
    type TaskSnapshot,
    type TaskStartOptions
} from '$lib/components/entities/Task/Task.svelte.js';

export type MissionSnapshotLoader = (missionId: string) => Promise<MissionSnapshot>;
type MissionQueryExecutionContext = 'event' | 'render';

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
    startTask(input: {
        missionId: string;
        taskId: string;
        terminalSessionName?: string;
    }): Promise<MissionCommandAcknowledgement>;
    completeTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionCommandAcknowledgement>;
    reopenTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionCommandAcknowledgement>;
    completeSession(input: {
        missionId: string;
        sessionId: string;
    }): Promise<MissionCommandAcknowledgement>;
    cancelSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionCommandAcknowledgement>;
    terminateSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionCommandAcknowledgement>;
    sendSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<MissionCommandAcknowledgement>;
    sendSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
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

export class Mission implements EntityModel<MissionSnapshot> {
    private readonly loadSnapshot: MissionSnapshotLoader;
    private readonly commands: MissionCommandGateway;
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
        commands: MissionCommandGateway = unavailableMissionCommands
    ) {
        this.snapshot = snapshot;
        this.loadSnapshot = loadSnapshot;
        this.commands = commands;
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
                completeSession: async (sessionId) => {
                    await this.commands.completeSession({
                        missionId: this.missionId,
                        sessionId
                    });
                    await this.refresh();
                },
                cancelSession: async (sessionId, reason) => {
                    await this.commands.cancelSession({
                        missionId: this.missionId,
                        sessionId,
                        ...(reason?.trim() ? { reason: reason.trim() } : {})
                    });
                    await this.refresh();
                },
                terminateSession: async (sessionId, reason) => {
                    await this.commands.terminateSession({
                        missionId: this.missionId,
                        sessionId,
                        ...(reason?.trim() ? { reason: reason.trim() } : {})
                    });
                    await this.refresh();
                },
                sendSessionPrompt: async (sessionId, prompt) => {
                    await this.commands.sendSessionPrompt({
                        missionId: this.missionId,
                        sessionId,
                        prompt
                    });
                    await this.refresh();
                },
                sendSessionCommand: async (sessionId, command) => {
                    await this.commands.sendSessionCommand({
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
                startTask: async (taskId, options: TaskStartOptions = {}) => {
                    await this.commands.startTask({
                        missionId: this.missionId,
                        taskId,
                        ...(options.terminalSessionName?.trim()
                            ? { terminalSessionName: options.terminalSessionName.trim() }
                            : {})
                    });
                    await this.refresh();
                },
                completeTask: async (taskId) => {
                    await this.commands.completeTask({
                        missionId: this.missionId,
                        taskId
                    });
                    await this.refresh();
                },
                reopenTask: async (taskId) => {
                    await this.commands.reopenTask({
                        missionId: this.missionId,
                        taskId
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
            (stage) => new Stage(stage, (taskId) => this.tasks.get(taskId))
        );
    }

    private applyArtifactSnapshots(snapshot: MissionSnapshot): void {
        this.applyArtifactDataSnapshots(snapshot.artifacts);
    }

    private applyArtifactDataSnapshots(artifacts: MissionArtifactSnapshot[]): void {
        const artifactSnapshots: ArtifactSnapshot[] = artifacts.map((artifact) => ({
            filePath: artifact.filePath ?? artifact.relativePath ?? artifact.artifactId,
            label: artifact.label,
            ...(artifact.stageId ? { stageId: artifact.stageId } : {}),
            ...(artifact.taskId ? { taskId: artifact.taskId } : {})
        }));

        this.artifacts.reconcile(
            artifactSnapshots,
            (artifactSnapshot) => artifactSnapshot.filePath,
            (artifactSnapshot) => this.createArtifactEntity(artifactSnapshot)
        );
    }

    private createArtifactEntity(snapshot: ArtifactSnapshot): Artifact {
        return new Artifact(snapshot, {
            readArtifact: async (filePath, input) => {
                return this.commands.readMissionDocument({
                    missionId: this.missionId,
                    path: filePath,
                    ...(input?.executionContext ? { executionContext: input.executionContext } : {})
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

    private async runCommandAndRefresh(command: Promise<MissionCommandAcknowledgement>): Promise<this> {
        await command;
        await this.refresh();
        return this;
    }
}
