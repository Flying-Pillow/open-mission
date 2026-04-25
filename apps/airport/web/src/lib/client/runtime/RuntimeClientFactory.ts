// /apps/airport/web/src/lib/client/runtime/RuntimeClientFactory.ts: Entity-agnostic runtime client base and factory wiring transport, cache, and entity materialization.
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { EntityRuntimeStore } from '$lib/client/runtime/EntityRuntimeStore';
import type { RuntimeSubscription } from '$lib/client/runtime/transport/EntityRuntimeTransport';

export type EntityRuntimeClientTransport<TId extends string, TSnapshot, TEvent> = {
    getSnapshot(id: TId): Promise<TSnapshot>;
    observe(input: {
        id: TId;
        onEvent?: (event: TEvent) => void | Promise<void>;
        onError?: (error: Error) => void;
    }): RuntimeSubscription;
};

export interface EntityRuntimeClient<
    TId extends string,
    TSnapshot,
    TEntity extends EntityModel<TSnapshot, TId>,
    TEvent
> {
    get(id: TId): Promise<TEntity>;
    observe(input: {
        id: TId;
        onUpdate?: (entity: TEntity, event: TEvent) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription;
}

class DefaultEntityRuntimeClient<
    TId extends string,
    TSnapshot,
    TEntity extends EntityModel<TSnapshot, TId>,
    TEvent
> implements EntityRuntimeClient<TId, TSnapshot, TEntity, TEvent> {
    private readonly store: EntityRuntimeStore<TId, TSnapshot, TEntity>;

    public constructor(
        private readonly transport: EntityRuntimeClientTransport<TId, TSnapshot, TEvent>,
        input: {
            createEntity: (snapshot: TSnapshot, loadSnapshot: (id: TId) => Promise<TSnapshot>) => TEntity;
            selectEntityId: (snapshot: TSnapshot) => TId;
        }
    ) {
        this.store = new EntityRuntimeStore({
            loadSnapshot: (id) => this.transport.getSnapshot(id),
            createEntity: (snapshot, loadSnapshot) => input.createEntity(snapshot, loadSnapshot),
            selectId: (snapshot) => input.selectEntityId(snapshot)
        });
    }

    public async get(id: TId): Promise<TEntity> {
        return this.store.get(id);
    }

    public observe(input: {
        id: TId;
        onUpdate?: (entity: TEntity, event: TEvent) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        return this.transport.observe({
            id: input.id,
            onEvent: async (event) => {
                const entity = await this.store.refresh(input.id);
                input.onUpdate?.(entity, event);
            },
            onError: input.onError
        });
    }
}

export function createEntityRuntimeClient<
    TId extends string,
    TSnapshot,
    TEntity extends EntityModel<TSnapshot, TId>,
    TEvent
>(input: {
    transport: EntityRuntimeClientTransport<TId, TSnapshot, TEvent>;
    createEntity: (snapshot: TSnapshot, loadSnapshot: (id: TId) => Promise<TSnapshot>) => TEntity;
    selectEntityId: (snapshot: TSnapshot) => TId;
}): EntityRuntimeClient<TId, TSnapshot, TEntity, TEvent> {
    return new DefaultEntityRuntimeClient(input.transport, {
        createEntity: input.createEntity,
        selectEntityId: input.selectEntityId
    });
}