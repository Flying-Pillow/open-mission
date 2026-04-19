// /apps/airport/web/src/lib/client/entities/Mission.ts: OO browser entity for a mission runtime snapshot and its live agent sessions.
import type {
    MissionAgentSessionDto,
    MissionRuntimeSnapshotDto
} from '@flying-pillow/mission-core';
import { AgentSession } from '$lib/client/entities/AgentSession';
import { EntityRegistry, type EntityModel } from '$lib/client/entities/EntityModel';
import { Task, type TaskSnapshot } from '$lib/client/entities/Task';

export type MissionSnapshotLoader = (missionId: string) => Promise<MissionRuntimeSnapshotDto>;

export class Mission implements EntityModel<MissionRuntimeSnapshotDto> {
    private readonly loadSnapshot: MissionSnapshotLoader;
    private snapshot: MissionRuntimeSnapshotDto;
    private readonly sessions = new EntityRegistry<string, MissionAgentSessionDto, AgentSession>();
    private readonly tasks = new EntityRegistry<string, TaskSnapshot, Task>();

    public constructor(snapshot: MissionRuntimeSnapshotDto, loadSnapshot: MissionSnapshotLoader) {
        this.snapshot = structuredClone(snapshot);
        this.loadSnapshot = loadSnapshot;
        this.applySessionDtos(snapshot.sessions);
        this.applyTaskDtos(snapshot);
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

    public get workflowStages(): NonNullable<
        NonNullable<MissionRuntimeSnapshotDto['status']['workflow']>['stages']
    > {
        return structuredClone(this.snapshot.status.workflow?.stages ?? []);
    }

    public listSessions(): AgentSession[] {
        return this.sessions.values();
    }

    public listTasks(): Task[] {
        return this.tasks.values();
    }

    public listTasksForStage(stageId: string): Task[] {
        return this.listTasks().filter((task) => task.stageId === stageId);
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
            (sessionDto) => new AgentSession(sessionDto)
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
            (taskSnapshot) => new Task(taskSnapshot)
        );
    }
}