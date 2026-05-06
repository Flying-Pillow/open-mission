// /apps/airport/web/src/lib/components/entities/Task/Task.svelte.ts: OO browser entity for workflow tasks exposed by a mission snapshot.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { TaskCommandIds, type TaskConfigureCommandOptionsType, type TaskDataType, type TaskStartCommandOptionsType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type TaskSnapshot = {
    stageId: string;
    task: TaskDataType;
};

export type TaskStartOptions = {
    agentAdapter?: string;
    model?: string;
    reasoningEffort?: TaskStartCommandOptionsType['reasoningEffort'];
    terminalName?: string;
};

export type TaskConfigureOptions = TaskConfigureCommandOptionsType;

export type TaskDependencies = {
    resolveCommands(taskId: string): EntityCommandDescriptorType[];
    executeCommand(taskId: string, commandId: string, input?: unknown): Promise<void>;
};

export class Task implements EntityModel<TaskSnapshot> {
    private snapshotState = $state<TaskSnapshot | undefined>();
    private readonly dependencies: TaskDependencies;

    public constructor(snapshot: TaskSnapshot, dependencies: TaskDependencies) {
        this.snapshot = snapshot;
        this.dependencies = dependencies;
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

    public get agentAdapter(): string {
        return this.snapshot.task.agentAdapter;
    }

    public get model(): string | undefined {
        return this.snapshot.task.model;
    }

    public get reasoningEffort(): TaskStartCommandOptionsType['reasoningEffort'] | undefined {
        return this.snapshot.task.reasoningEffort;
    }

    public get autostart(): boolean {
        return this.snapshot.task.autostart ?? false;
    }

    public get dependsOn(): string[] {
        return [...this.snapshot.task.dependsOn];
    }

    public get context(): NonNullable<TaskDataType['context']> {
        return this.snapshot.task.context?.map((contextArtifact) => ({ ...contextArtifact })) ?? [];
    }

    public get waitingOnTaskIds(): string[] {
        return [...this.snapshot.task.waitingOnTaskIds];
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.taskId);
    }

    public async start(options: TaskStartOptions = {}): Promise<this> {
        await this.executeCommand(TaskCommandIds.start, options);
        return this;
    }

    public async configure(options: TaskConfigureOptions): Promise<this> {
        await this.executeCommand(TaskCommandIds.configure, options);
        return this;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.dependencies.executeCommand(this.taskId, commandId, input);
    }

    public async complete(): Promise<this> {
        await this.executeCommand(TaskCommandIds.complete);
        return this;
    }

    public async reopen(): Promise<this> {
        await this.executeCommand(TaskCommandIds.reopen);
        return this;
    }

    public updateFromData(snapshot: TaskSnapshot): this {
        this.snapshot = snapshot;
        return this;
    }

    public update(data: TaskDataType, stageId = this.stageId): this {
        return this.updateFromData({
            stageId,
            task: data
        });
    }

    public toData(): TaskSnapshot {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): TaskDataType {
        return structuredClone($state.snapshot(this.snapshot.task));
    }

    public toStageSnapshot(): TaskSnapshot {
        return this.toData();
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
