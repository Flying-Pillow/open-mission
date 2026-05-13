// /apps/web/src/lib/client/runtime/EntityRuntimeStore.ts: Generic runtime store for loading, caching, and refreshing entity models by identity.
import type { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';

export class EntityRuntimeStore<
    TId extends string,
    TData,
    TEntity extends Entity<TData, TId>
> {
    private readonly entities = new Map<TId, TEntity>();

    public constructor(private readonly input: {
        loadData: (id: TId) => Promise<TData>;
        createEntity: (
            data: TData,
            loadData: (id: TId) => Promise<TData>
        ) => TEntity;
        selectId: (data: TData) => TId;
    }) { }

    public async get(id: TId): Promise<TEntity> {
        const existing = this.entities.get(id);
        if (existing) {
            return existing;
        }

        const data = await this.input.loadData(id);
        return this.upsertData(data);
    }

    public async refresh(id: TId): Promise<TEntity> {
        const data = await this.input.loadData(id);
        return this.upsertData(data);
    }

    public upsertData(data: TData): TEntity {
        const id = this.input.selectId(data);
        const existing = this.entities.get(id);
        if (existing) {
            existing.updateFromData(data);
            return existing;
        }

        const created = this.input.createEntity(data, this.input.loadData);
        this.entities.set(id, created);
        return created;
    }
}