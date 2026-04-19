// /apps/airport/web/src/lib/client/entities/Task.ts: OO browser entity for workflow tasks exposed by a mission snapshot.
import type { MissionRuntimeSnapshotDto } from '@flying-pillow/mission-core/airport/runtime';
import type { EntityModel } from '$lib/client/entities/EntityModel';

export type MissionWorkflowTaskDto = NonNullable<
    NonNullable<MissionRuntimeSnapshotDto['status']['workflow']>['stages']
>[number]['tasks'][number];

export type TaskSnapshot = {
    stageId: string;
    task: MissionWorkflowTaskDto;
};

export type TaskStartOptions = {
    terminalSessionName?: string;
};

export type TaskCommandOwner = {
    startTask(taskId: string, options?: TaskStartOptions): Promise<void>;
    completeTask(taskId: string): Promise<void>;
    blockTask(taskId: string): Promise<void>;
    reopenTask(taskId: string): Promise<void>;
};

export class Task implements EntityModel<TaskSnapshot> {
    private snapshot: TaskSnapshot;
    private readonly owner: TaskCommandOwner;

    public constructor(snapshot: TaskSnapshot, owner: TaskCommandOwner) {
        this.snapshot = structuredClone(snapshot);
        this.owner = owner;
    }

    public get taskId(): string {
        return this.snapshot.task.taskId;
    }

    public get id(): string {
        return this.taskId;
    }

    public get stageId(): string {
        return this.snapshot.stageId;
    }

    public get title(): string {
        return this.snapshot.task.title;
    }

    public get lifecycle(): string {
        return this.snapshot.task.lifecycle;
    }

    public get dependsOn(): string[] {
        return [...this.snapshot.task.dependsOn];
    }

    public get blockedByTaskIds(): string[] {
        return [...this.snapshot.task.blockedByTaskIds];
    }

    public async start(options: TaskStartOptions = {}): Promise<this> {
        await this.owner.startTask(this.taskId, options);
        return this;
    }

    public async complete(): Promise<this> {
        await this.owner.completeTask(this.taskId);
        return this;
    }

    public async block(): Promise<this> {
        await this.owner.blockTask(this.taskId);
        return this;
    }

    public async reopen(): Promise<this> {
        await this.owner.reopenTask(this.taskId);
        return this;
    }

    public updateFromSnapshot(snapshot: TaskSnapshot): this {
        this.snapshot = structuredClone(snapshot);
        return this;
    }

    public update(data: MissionWorkflowTaskDto, stageId = this.stageId): this {
        return this.updateFromSnapshot({
            stageId,
            task: data
        });
    }

    public toSnapshot(): TaskSnapshot {
        return structuredClone(this.snapshot);
    }

    public toJSON(): MissionWorkflowTaskDto {
        return structuredClone(this.snapshot.task);
    }

    public toStageSnapshot(): TaskSnapshot {
        return this.toSnapshot();
    }

    public withStage(stageId: string): this {
        this.snapshot = {
            ...this.snapshot,
            stageId
        };
        return this;
    }
}