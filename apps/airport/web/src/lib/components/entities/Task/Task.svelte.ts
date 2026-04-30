// /apps/airport/web/src/lib/components/entities/Task/Task.svelte.ts: OO browser entity for workflow tasks exposed by a mission snapshot.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { MissionTaskSnapshot } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type TaskData = MissionTaskSnapshot;

export type TaskSnapshot = {
    stageId: string;
    task: TaskData;
};

export type TaskStartOptions = {
    terminalSessionName?: string;
};

export type TaskCommandOwner = {
    executeTaskCommand(taskId: string, commandId: string, input?: unknown): Promise<void>;
};

export class Task implements EntityModel<TaskSnapshot> {
    private snapshotState = $state<TaskSnapshot | undefined>();
    private readonly owner: TaskCommandOwner;

    public constructor(snapshot: TaskSnapshot, owner: TaskCommandOwner) {
        this.snapshot = snapshot;
        this.owner = owner;
    }

    private get snapshot(): TaskSnapshot {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Task snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: TaskSnapshot) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get taskId(): string {
        return this.snapshot.task.taskId;
    }

    public get id(): string {
        return this.taskId;
    }

    public get entityName(): 'Task' {
        return 'Task';
    }

    public get entityId(): string {
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

    public get waitingOnTaskIds(): string[] {
        return [...this.snapshot.task.waitingOnTaskIds];
    }

    public get commands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.snapshot.task.commands ?? []));
    }

    public async start(options: TaskStartOptions = {}): Promise<this> {
        await this.executeCommand('task.start', options);
        return this;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.owner.executeTaskCommand(this.taskId, commandId, input);
    }

    public async complete(): Promise<this> {
        await this.executeCommand('task.complete');
        return this;
    }

    public async reopen(): Promise<this> {
        await this.executeCommand('task.reopen');
        return this;
    }

    public updateFromSnapshot(snapshot: TaskSnapshot): this {
        this.snapshot = snapshot;
        return this;
    }

    public update(data: TaskData, stageId = this.stageId): this {
        return this.updateFromSnapshot({
            stageId,
            task: data
        });
    }

    public toSnapshot(): TaskSnapshot {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): TaskData {
        return structuredClone($state.snapshot(this.snapshot.task));
    }

    public toStageSnapshot(): TaskSnapshot {
        return this.toSnapshot();
    }

    public withStage(stageId: string): this {
        const snapshot = $state.snapshot(this.snapshot);
        this.snapshot = {
            ...snapshot,
            stageId
        };
        return this;
    }
}
