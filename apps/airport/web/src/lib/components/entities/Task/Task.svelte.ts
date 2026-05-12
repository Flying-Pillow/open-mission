// /apps/airport/web/src/lib/components/entities/Task/Task.svelte.ts: OO browser entity for workflow tasks exposed by hydrated mission data.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { TaskCommandIds, type TaskConfigureCommandOptionsType, type TaskDataType, type TaskStartCommandOptionsType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { AgentExecution } from '$lib/components/entities/AgentExecution/AgentExecution.svelte.js';
import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';

export type TaskHydratedData = {
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
    resolveAgentExecution(taskId: string): AgentExecution | undefined;
    executeCommand(taskId: string, commandId: string, input?: unknown): Promise<void>;
};

export class Task extends Entity<TaskHydratedData> {
    private data = $state<TaskHydratedData | undefined>();
    private readonly dependencies: TaskDependencies;

    public constructor(data: TaskHydratedData, dependencies: TaskDependencies) {
        super();
        this.setData(data);
        this.dependencies = dependencies;
    }

    private requireData(): TaskHydratedData {
        const data = this.data;
        if (!data) {
            throw new Error('Task data is not initialized.');
        }

        return data;
    }

    private setData(data: TaskHydratedData): void {
        this.data = structuredClone(data);
    }

    public get taskId(): string {
        return this.requireData().task.taskId;
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

    protected get entityLocator(): Record<string, unknown> {
        return {
            taskId: this.taskId
        };
    }

    public get stageId(): string {
        return this.requireData().stageId;
    }

    public get title(): string {
        return this.requireData().task.title;
    }

    public get lifecycle(): string {
        return this.requireData().task.lifecycle;
    }

    public get agentAdapter(): string {
        return this.requireData().task.agentAdapter;
    }

    public get model(): string | undefined {
        return this.requireData().task.model;
    }

    public get reasoningEffort(): TaskStartCommandOptionsType['reasoningEffort'] | undefined {
        return this.requireData().task.reasoningEffort;
    }

    public get autostart(): boolean {
        return this.requireData().task.autostart ?? false;
    }

    public get dependsOn(): string[] {
        return [...this.requireData().task.dependsOn];
    }

    public get context(): NonNullable<TaskDataType['context']> {
        return this.requireData().task.context?.map((contextArtifact) => ({ ...contextArtifact })) ?? [];
    }

    public get waitingOnTaskIds(): string[] {
        return [...this.requireData().task.waitingOnTaskIds];
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.taskId);
    }

    public get agentExecution(): AgentExecution | undefined {
        return this.dependencies.resolveAgentExecution(this.taskId);
    }

    public async start(options: TaskStartOptions = {}): Promise<this> {
        await this.executeCommand(TaskCommandIds.start, options);
        return this;
    }

    public async configure(options: TaskConfigureOptions): Promise<this> {
        await this.executeCommand(TaskCommandIds.configure, options);
        return this;
    }

    public async executeCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
        await this.dependencies.executeCommand(this.taskId, commandId, input);
        return undefined as TResult;
    }

    public async complete(): Promise<this> {
        await this.executeCommand(TaskCommandIds.complete);
        return this;
    }

    public async reopen(): Promise<this> {
        await this.executeCommand(TaskCommandIds.reopen);
        return this;
    }

    public updateFromData(data: TaskHydratedData): this {
        this.setData(data);
        return this;
    }

    public update(data: TaskDataType, stageId = this.stageId): this {
        return this.updateFromData({
            stageId,
            task: data
        });
    }

    public toData(): TaskHydratedData {
        return structuredClone($state.snapshot(this.requireData()));
    }

    public toTaskData(): TaskDataType {
        return structuredClone($state.snapshot(this.requireData().task));
    }

    public toStageData(): TaskHydratedData {
        return this.toData();
    }

    public toJSON(): TaskHydratedData {
        return this.toData();
    }

    public withStage(stageId: string): this {
        const data = $state.snapshot(this.requireData());
        this.setData({
            ...data,
            stageId
        });
        return this;
    }
}
