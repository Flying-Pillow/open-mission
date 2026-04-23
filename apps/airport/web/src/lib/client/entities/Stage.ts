// /apps/airport/web/src/lib/client/entities/Stage.ts: OO browser entity for a mission workflow stage with task accessors.
import type {
    MissionRuntimeSnapshot,
    Stage as StageSnapshotRecord
} from '@flying-pillow/mission-core/airport/runtime';
import type { EntityModel } from '$lib/client/entities/EntityModel';
import type { Task } from '$lib/client/entities/Task';

export type StageSnapshot = NonNullable<
    NonNullable<MissionRuntimeSnapshot['status']['workflow']>['stages']
>[number] & Stage;

export class Stage implements EntityModel<StageSnapshot> {
    private snapshot: StageSnapshot;
    private readonly resolveTask: (taskId: string) => Task | undefined;

    public constructor(
        snapshot: StageSnapshot,
        resolveTask: (taskId: string) => Task | undefined
    ) {
        this.snapshot = structuredClone(snapshot);
        this.resolveTask = resolveTask;
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
        return structuredClone(this.snapshot.artifacts);
    }

    public listTasks(): Task[] {
        return this.snapshot.tasks
            .map((task) => this.resolveTask(task.taskId))
            .filter((task): task is Task => task !== undefined);
    }

    public updateFromSnapshot(snapshot: StageSnapshot): this {
        this.snapshot = structuredClone(snapshot);
        return this;
    }

    public toSnapshot(): StageSnapshot {
        return structuredClone(this.snapshot);
    }

    public toJSON(): StageSnapshot {
        return this.toSnapshot();
    }
}
