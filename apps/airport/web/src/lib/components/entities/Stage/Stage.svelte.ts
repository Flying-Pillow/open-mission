// /apps/airport/web/src/lib/components/entities/Stage/Stage.svelte.ts: OO browser entity for a mission workflow stage with task accessors.
import type {
    MissionRuntimeSnapshot,
    Stage as StageSnapshotRecord
} from '@flying-pillow/mission-core/schemas';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import type { Task } from '$lib/components/entities/Task/Task.svelte.js';

export type StageSnapshot = NonNullable<
    NonNullable<MissionRuntimeSnapshot['status']['workflow']>['stages']
>[number];

export class Stage implements EntityModel<StageSnapshot> {
    private snapshotState = $state<StageSnapshot | undefined>();
    private readonly resolveTask: (taskId: string) => Task | undefined;

    public constructor(
        snapshot: StageSnapshot,
        resolveTask: (taskId: string) => Task | undefined
    ) {
        this.snapshot = snapshot;
        this.resolveTask = resolveTask;
    }

    private get snapshot(): StageSnapshot {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Stage snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: StageSnapshot) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get stageId(): string {
        return this.snapshot.stageId;
    }

    public get id(): string {
        return this.stageId;
    }

    public get lifecycle(): string {
        return this.snapshot.lifecycle;
    }

    public get isCurrentStage(): boolean {
        return this.snapshot.isCurrentStage;
    }

    public get artifacts(): StageSnapshot['artifacts'] {
        return structuredClone($state.snapshot(this.snapshot.artifacts));
    }

    public listTasks(): Task[] {
        return this.snapshot.tasks
            .map((task) => this.resolveTask(task.taskId))
            .filter((task): task is Task => task !== undefined);
    }

    public updateFromSnapshot(snapshot: StageSnapshot): this {
        this.snapshot = snapshot;
        return this;
    }

    public toSnapshot(): StageSnapshot {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): StageSnapshot {
        return this.toSnapshot();
    }
}
