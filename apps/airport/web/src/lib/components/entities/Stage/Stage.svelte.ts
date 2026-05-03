// /apps/airport/web/src/lib/components/entities/Stage/Stage.svelte.ts: OO browser entity for a mission workflow stage with task accessors.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { StageDataType } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import type { Task } from '$lib/components/entities/Task/Task.svelte.js';

export type StageDependencies = {
    resolveCommands(stageId: string): EntityCommandDescriptorType[];
    resolveTask(taskId: string): Task | undefined;
    executeCommand(stageId: string, commandId: string, input?: unknown): Promise<void>;
};

export class Stage implements EntityModel<StageDataType> {
    private snapshotState = $state<StageDataType | undefined>();
    private readonly dependencies: StageDependencies;

    public constructor(snapshot: StageDataType, dependencies: StageDependencies) {
        this.snapshot = snapshot;
        this.dependencies = dependencies;
    }

    private get snapshot(): StageDataType {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Stage snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: StageDataType) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get stageId(): string {
        return this.snapshot.stageId;
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

    public get lifecycle(): string {
        return this.snapshot.lifecycle;
    }

    public get isCurrentStage(): boolean {
        return this.snapshot.isCurrentStage;
    }

    public get artifacts(): StageDataType['artifacts'] {
        return structuredClone($state.snapshot(this.snapshot.artifacts));
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.stageId);
    }

    public listTasks(): Task[] {
        return this.snapshot.tasks
            .map((task) => this.dependencies.resolveTask(task.taskId))
            .filter((task): task is Task => task !== undefined);
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.dependencies.executeCommand(this.stageId, commandId, input);
    }

    public updateFromData(snapshot: StageDataType): this {
        this.snapshot = snapshot;
        return this;
    }

    public toData(): StageDataType {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): StageDataType {
        return this.toData();
    }
}
