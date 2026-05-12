// /apps/airport/web/src/lib/components/entities/Stage/Stage.svelte.ts: OO browser entity for a mission workflow stage with task accessors.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { StageDataType } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';
import type { Task } from '$lib/components/entities/Task/Task.svelte.js';

export type StageDependencies = {
    resolveCommands(stageId: string): EntityCommandDescriptorType[];
    resolveTask(taskId: string): Task | undefined;
    executeCommand(stageId: string, commandId: string, input?: unknown): Promise<void>;
};

export class Stage extends Entity<StageDataType> {
    private data = $state<StageDataType | undefined>();
    private readonly dependencies: StageDependencies;

    public constructor(data: StageDataType, dependencies: StageDependencies) {
        super();
        this.setData(data);
        this.dependencies = dependencies;
    }

    private requireData(): StageDataType {
        const data = this.data;
        if (!data) {
            throw new Error('Stage data is not initialized.');
        }

        return data;
    }

    private setData(data: StageDataType): void {
        this.data = structuredClone(data);
    }

    public get stageId(): string {
        return this.requireData().stageId;
    }

    public get id(): string {
        return this.stageId;
    }

    public get entityName(): 'Stage' {
        return 'Stage';
    }

    public get entityId(): string {
        return this.stageId;
    }

    protected get entityLocator(): Record<string, unknown> {
        return {
            stageId: this.stageId
        };
    }

    public get lifecycle(): string {
        return this.requireData().lifecycle;
    }

    public get isCurrentStage(): boolean {
        return this.requireData().isCurrentStage;
    }

    public get artifacts(): StageDataType['artifacts'] {
        return structuredClone($state.snapshot(this.requireData().artifacts));
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.stageId);
    }

    public listTasks(): Task[] {
        return this.requireData().tasks
            .map((task) => this.dependencies.resolveTask(task.taskId))
            .filter((task): task is Task => task !== undefined);
    }

    public async executeCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
        await this.dependencies.executeCommand(this.stageId, commandId, input);
        return undefined as TResult;
    }

    public updateFromData(data: StageDataType): this {
        this.setData(data);
        return this;
    }

    public toData(): StageDataType {
        return structuredClone($state.snapshot(this.requireData()));
    }

    public toJSON(): StageDataType {
        return this.toData();
    }
}
