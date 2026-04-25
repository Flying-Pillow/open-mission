// /apps/airport/web/src/lib/components/entities/shared/EntityModel.svelte.ts: Shared contracts and reconciliation registry for OO client entities.
export interface EntityModel<TSnapshot, TId extends string = string> {
    readonly id: TId;
    updateFromSnapshot(snapshot: TSnapshot): this;
    toSnapshot(): TSnapshot;
}

export class EntityRegistry<
    TId extends string,
    TSnapshot,
    TEntity extends EntityModel<TSnapshot, TId>
> {
    private entities = new Map<TId, TEntity>();
    private version = $state(0);

    public get(id: TId): TEntity | undefined {
        this.version;
        return this.entities.get(id);
    }

    public values(): TEntity[] {
        this.version;
        return [...this.entities.values()];
    }

    public reconcile(
        snapshots: TSnapshot[],
        selectId: (snapshot: TSnapshot) => TId,
        factory: (snapshot: TSnapshot) => TEntity
    ): this {
        const previousEntities = this.entities;
        const nextEntities = new Map<TId, TEntity>();
        const nextIds = new Set<TId>();
        let changed = previousEntities.size !== snapshots.length;

        for (const snapshot of snapshots) {
            const id = selectId(snapshot);
            nextIds.add(id);
            const existing = previousEntities.get(id);
            if (existing) {
                existing.updateFromSnapshot(snapshot);
                nextEntities.set(id, existing);
                continue;
            }

            nextEntities.set(id, factory(snapshot));
            changed = true;
        }

        for (const currentId of [...previousEntities.keys()]) {
            if (!nextIds.has(currentId)) {
                changed = true;
            }
        }

        const previousIds = [...previousEntities.keys()];
        const nextEntityIds = [...nextEntities.keys()];
        if (!changed && previousIds.length === nextEntityIds.length) {
            changed = previousIds.some((id, index) => id !== nextEntityIds[index]);
        }

        this.entities = nextEntities;
        if (changed) {
            this.version += 1;
        }

        return this;
    }
}