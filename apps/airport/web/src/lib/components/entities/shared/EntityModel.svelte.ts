// /apps/airport/web/src/lib/components/entities/shared/EntityModel.svelte.ts: Shared contracts and reconciliation registry for OO client entities.
export interface EntityModel<TData, TId extends string = string> {
    readonly id: TId;
    updateFromData(data: TData): this;
    toData(): TData;
}

export class EntityRegistry<
    TId extends string,
    TData,
    TEntity extends EntityModel<TData, TId>
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
        dataItems: TData[],
        selectId: (data: TData) => TId,
        factory: (data: TData) => TEntity
    ): this {
        const previousEntities = this.entities;
        const nextEntities = new Map<TId, TEntity>();
        const nextIds = new Set<TId>();
        let changed = previousEntities.size !== dataItems.length;

        for (const data of dataItems) {
            const id = selectId(data);
            nextIds.add(id);
            const existing = previousEntities.get(id);
            if (existing) {
                existing.updateFromData(data);
                nextEntities.set(id, existing);
                continue;
            }

            nextEntities.set(id, factory(data));
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