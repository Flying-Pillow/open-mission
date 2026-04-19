// /apps/airport/web/src/lib/client/entities/EntityModel.ts: Shared contracts and reconciliation registry for OO client entities.
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
    private readonly entities = new Map<TId, TEntity>();

    public get(id: TId): TEntity | undefined {
        return this.entities.get(id);
    }

    public values(): TEntity[] {
        return [...this.entities.values()];
    }

    public reconcile(
        snapshots: TSnapshot[],
        selectId: (snapshot: TSnapshot) => TId,
        factory: (snapshot: TSnapshot) => TEntity
    ): this {
        const nextIds = new Set<TId>();

        for (const snapshot of snapshots) {
            const id = selectId(snapshot);
            nextIds.add(id);
            const existing = this.entities.get(id);
            if (existing) {
                existing.updateFromSnapshot(snapshot);
                continue;
            }

            this.entities.set(id, factory(snapshot));
        }

        for (const currentId of [...this.entities.keys()]) {
            if (!nextIds.has(currentId)) {
                this.entities.delete(currentId);
            }
        }

        return this;
    }
}