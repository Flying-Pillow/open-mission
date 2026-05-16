import { getTableMetadata } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import type { Entity } from '../entities/Entity/Entity.js';
import { FilesystemEntityStore } from '../entities/Entity/FilesystemEntityStore.js';
import {
    EntityTableSchema,
    type EntityStorageType,
    type FindResultType,
    type SelectType
} from '../entities/Entity/EntitySchema.js';
import {
    SurrealDatabase,
    type SurrealDatabaseOptions
} from './database/SurrealDatabase.js';
import { SurrealEntityStore } from './database/SurrealEntityStore.js';

export { FilesystemEntityStore } from '../entities/Entity/FilesystemEntityStore.js';

export type EntityFindSelection = SelectType;

export type EntityFindResult<TStorage extends object = object> = FindResultType<TStorage>;

export type PersistedEntityClass<
    TEntity extends Entity<object, string>,
    TStorage extends EntityStorageType
> = {
    readonly entityName: string;
    readonly storageSchema: z.ZodType<TStorage>;
    new(data: TStorage): TEntity;
};

export interface FactoryStore {
    create<TStorage extends EntityStorageType>(table: string, record: TStorage): Promise<TStorage>;
    save<TStorage extends EntityStorageType>(table: string, record: TStorage): Promise<TStorage>;
    relate<TStorage extends EntityStorageType>(table: string, record: TStorage): Promise<TStorage>;
    read<TStorage extends object>(table: string, id: string): Promise<TStorage | undefined>;
    find<TStorage extends object>(
        table: string,
        storageSchema: z.ZodType<TStorage>,
        select?: EntityFindSelection
    ): Promise<EntityFindResult<TStorage>>;
    remove(table: string, id: string): Promise<void>;
}

export class Factory {
    public constructor(private readonly store: FactoryStore = new FilesystemEntityStore()) { }

    public async create<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, record: TStorage): Promise<TEntity> {
        const { table, storageSchema, tableMetadata } = resolveEntityStorage(entityClass);
        const parsedRecord = storageSchema.parse(record) as TStorage;
        const persisted = tableMetadata.kind === 'relation'
            ? await this.store.relate(table, parsedRecord)
            : await this.store.create(table, parsedRecord);
        return this.hydrate(entityClass, persisted);
    }

    public async save<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, record: TStorage): Promise<TEntity> {
        const { table, storageSchema, tableMetadata } = resolveEntityStorage(entityClass);
        const parsedRecord = storageSchema.parse(record) as TStorage;
        const persisted = tableMetadata.kind === 'relation'
            ? await this.store.relate(table, parsedRecord)
            : await this.store.save(table, parsedRecord);
        return this.hydrate(entityClass, persisted);
    }

    public async relate<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, record: TStorage): Promise<TEntity> {
        const { table, storageSchema, tableMetadata } = resolveEntityStorage(entityClass);
        if (tableMetadata.kind !== 'relation') {
            throw new Error(`Entity '${entityClass.entityName}' is not backed by a relation table.`);
        }

        const parsedRecord = storageSchema.parse(record) as TStorage;
        return this.hydrate(entityClass, await this.store.relate(table, parsedRecord));
    }

    public async read<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, id: string): Promise<TEntity | undefined> {
        const { table } = resolveEntityStorage(entityClass);
        const record = await this.store.read<TStorage>(table, id);
        return record === undefined ? undefined : this.hydrate(entityClass, record);
    }

    public async find<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, select?: EntityFindSelection): Promise<FindResultType<TEntity>> {
        const { table, storageSchema } = resolveEntityStorage(entityClass);
        const result = await this.store.find(table, storageSchema, select);
        return {
            ...result,
            entities: result.entities.map((record) => this.hydrate(entityClass, record))
        };
    }

    public async remove<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, id: string): Promise<void> {
        const { table } = resolveEntityStorage(entityClass);
        await this.store.remove(table, id);
    }

    public hydrate<
        TEntity extends Entity<object, string>,
        TStorage extends EntityStorageType
    >(entityClass: PersistedEntityClass<TEntity, TStorage>, record: unknown): TEntity {
        const { storageSchema } = resolveEntityStorage(entityClass);
        return new entityClass(storageSchema.parse(record) as TStorage);
    }
}

export type EntityFactoryBackend = 'surreal' | 'filesystem';

export type CreateEntityFactoryOptions = {
    backend?: EntityFactoryBackend;
    store?: FactoryStore;
    database?: SurrealDatabase;
    namespace?: string;
    databaseName?: string;
    schemaDirectory?: string;
    provisionOnStart?: boolean;
    logger?: SurrealDatabaseOptions['logger'];
};

export function createEntityFactory(options: CreateEntityFactoryOptions = {}): Factory {
    if (options.store) {
        return new Factory(options.store);
    }

    if ((options.backend ?? 'surreal') === 'filesystem') {
        return createFilesystemEntityFactory();
    }

    return createSurrealEntityFactory(options);
}

export function createSurrealEntityFactory(options: Omit<CreateEntityFactoryOptions, 'backend' | 'store'>): Factory {
    const database = options.database ?? createSurrealDatabase(options);
    return new Factory(new SurrealEntityStore(database));
}

export function createFilesystemEntityFactory(): Factory {
    return new Factory(new FilesystemEntityStore());
}

export function configureDefaultEntityFactory(options: CreateEntityFactoryOptions = {}): Factory {
    const factory = createEntityFactory(options);
    setDefaultFactory(factory);
    return factory;
}

function createSurrealDatabase(options: Omit<CreateEntityFactoryOptions, 'backend' | 'store'>): SurrealDatabase {
    return SurrealDatabase.sharedForExternal({
        ...(options.namespace ? { namespace: options.namespace } : {}),
        ...(options.databaseName ? { database: options.databaseName } : {}),
        ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}),
        ...(options.provisionOnStart !== undefined ? { provisionOnStart: options.provisionOnStart } : {}),
        ...(options.logger ? { logger: options.logger } : {})
    });
}

let defaultFactory: Factory | undefined;

export function getDefaultFactory(): Factory {
    defaultFactory ??= new Factory();
    return defaultFactory;
}

export function setDefaultFactory(factory: Factory): void {
    defaultFactory = factory;
}

function resolveEntityStorage<
    TEntity extends Entity<object, string>,
    TStorage extends EntityStorageType
>(entityClass: PersistedEntityClass<TEntity, TStorage>): {
    table: string;
    storageSchema: z.ZodType<TStorage>;
    tableMetadata: NonNullable<ReturnType<typeof getTableMetadata>>;
} {
    const storageSchema = entityClass.storageSchema;
    const tableMetadata = getTableMetadata(storageSchema);
    if (!tableMetadata?.table) {
        throw new Error(`Entity '${entityClass.entityName}' storage schema is missing table metadata.`);
    }

    return {
        table: EntityTableSchema.parse(tableMetadata.table),
        storageSchema,
        tableMetadata
    };
}