// /apps/airport/web/src/lib/client/runtime/EntityRuntimeStore.ts: Generic runtime store for loading, caching, and refreshing entity models by identity.
import type { EntityModel } from '$lib/client/entities/EntityModel';

export class EntityRuntimeStore<
    TId extends string,
    TSnapshot,
    TEntity extends EntityModel<TSnapshot, TId>
> {
    private readonly entities = new Map<TId, TEntity>();

    public constructor(private readonly input: {
        loadSnapshot: (id: TId) => Promise<TSnapshot>;
        createEntity: (
            snapshot: TSnapshot,
            loadSnapshot: (id: TId) => Promise<TSnapshot>
        ) => TEntity;
        selectId: (snapshot: TSnapshot) => TId;
    }) {}

    public async get(id: TId): Promise<TEntity> {
        const existing = this.entities.get(id);
        if (existing) {
            return existing;
        }

        const snapshot = await this.input.loadSnapshot(id);
        return this.upsertSnapshot(snapshot);
    }

    public async refresh(id: TId): Promise<TEntity> {
        const snapshot = await this.input.loadSnapshot(id);
        return this.upsertSnapshot(snapshot);
    }

    public upsertSnapshot(snapshot: TSnapshot): TEntity {
        const id = this.input.selectId(snapshot);
        const existing = this.entities.get(id);
        if (existing) {
            existing.updateFromSnapshot(snapshot);
            return existing;
        }

        const created = this.input.createEntity(snapshot, this.input.loadSnapshot);
        this.entities.set(id, created);
        return created;
    }
}