// /apps/airport/web/src/lib/client/entities/Mission.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type {
    AgentCommandDto as AgentCommand,
    AgentPromptDto as AgentPrompt,
    MissionAgentSessionDto,
    MissionRuntimeSnapshotDto
} from '@flying-pillow/mission-core/airport/runtime';
import { AgentSession } from '$lib/client/entities/AgentSession';
import { EntityRegistry, type EntityModel } from '$lib/client/entities/EntityModel';
import { Stage, type MissionWorkflowStageDto } from '$lib/client/entities/Stage';
import {
    Task,
    type TaskSnapshot,
    type TaskStartOptions
} from '$lib/client/entities/Task';

export type MissionSnapshotLoader = (missionId: string) => Promise<MissionRuntimeSnapshotDto>;

export type MissionCommandGateway = {
    pauseMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    resumeMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    panicMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    clearMissionPanic(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    restartMissionQueue(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    deliverMission(input: {
        missionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    startTask(input: {
        missionId: string;
        taskId: string;
        terminalSessionName?: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    completeTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    reopenTask(input: {
        missionId: string;
        taskId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    completeSession(input: {
        missionId: string;
        sessionId: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    cancelSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    terminateSession(input: {
        missionId: string;
        sessionId: string;
        reason?: string;
    }): Promise<MissionRuntimeSnapshotDto>;
    sendSessionPrompt(input: {
        missionId: string;
        sessionId: string;
        prompt: AgentPrompt;
    }): Promise<MissionRuntimeSnapshotDto>;
    sendSessionCommand(input: {
        missionId: string;
        sessionId: string;
        command: AgentCommand;
    }): Promise<MissionRuntimeSnapshotDto>;
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
    }
};

export class Mission implements EntityModel<MissionRuntimeSnapshotDto> {
    private readonly loadSnapshot: MissionSnapshotLoader;
    private readonly commands: MissionCommandGateway;
    private snapshot: MissionRuntimeSnapshotDto;
    private readonly sessions = new EntityRegistry<string, MissionAgentSessionDto, AgentSession>();
    private readonly stages = new EntityRegistry<string, MissionWorkflowStageDto, Stage>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();

    public constructor(
        snapshot: MissionRuntimeSnapshotDto,
        loadSnapshot: MissionSnapshotLoader,
        commands: MissionCommandGateway = unavailableMissionCommands
    ) {
        this.snapshot = structuredClone(snapshot);
        this.loadSnapshot = loadSnapshot;
        this.commands = commands;
        this.applySessionDtos(snapshot.sessions);
        this.applyTaskDtos(snapshot);
        this.applyStageDtos(snapshot);
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

    public listStages(): Stage[] {
        return this.stages.values();
    }

    public getStage(stageId: string): Stage | undefined {
        return this.stages.get(stageId);
    }

    public listSessions(): AgentSession[] {
        return this.sessions.values();
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

    public async refresh(): Promise<this> {
        this.applySnapshot(await this.loadSnapshot(this.missionId));
        return this;
    }

    public updateFromSnapshot(snapshot: MissionRuntimeSnapshotDto): this {
        this.snapshot = structuredClone(snapshot);
        this.applySessionDtos(snapshot.sessions);
        this.applyTaskDtos(snapshot);
        this.applyStageDtos(snapshot);
        return this;
    }

    public applySnapshot(snapshot: MissionRuntimeSnapshotDto): this {
        return this.updateFromSnapshot(snapshot);
    }

    public toSnapshot(): MissionRuntimeSnapshotDto {
        return {
            ...structuredClone(this.snapshot),
            sessions: this.listSessions().map((session) => session.toSnapshot())
        };
    }

    public toJSON(): MissionRuntimeSnapshotDto {
        return this.toSnapshot();
    }

    private applySessionDtos(sessionDtos: MissionAgentSessionDto[]): void {
        this.sessions.reconcile(
            sessionDtos,
            (sessionDto) => sessionDto.sessionId,
            (sessionDto) => new AgentSession(sessionDto, {
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

    private applyTaskDtos(snapshot: MissionRuntimeSnapshotDto): void {
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

    private applyStageDtos(snapshot: MissionRuntimeSnapshotDto): void {
        this.stages.reconcile(
            snapshot.status.workflow?.stages ?? [],
            (stage) => stage.stageId,
            (stage) => new Stage(stage, (taskId) => this.tasks.get(taskId))
        );
    }
}