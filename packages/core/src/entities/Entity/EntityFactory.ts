import { z } from 'zod/v4';
import type { Entity } from './Entity.js';
import { EntityTableSchema } from './EntitySchema.js';
import { FilesystemEntityStore } from './FilesystemEntityStore.js';
import type { EntityStore } from './EntityStore.js';

export { FilesystemEntityStore } from './FilesystemEntityStore.js';
export type { EntityStore } from './EntityStore.js';

export type EntityConstructor<
    TEntity extends Entity<TStorage, string>,
    TStorage extends object
> = {
    readonly entityName: string;
    new(data: TStorage): TEntity;
};

export type EntityFactoryDefinition<
    TEntity extends Entity<TStorage, string>,
    TStorage extends object
> = {
    entityName: string;
    table: string;
    entityClass: EntityConstructor<TEntity, TStorage>;
    storageSchema: z.ZodType<TStorage>;
    getId(record: TStorage): string;
};

export class EntityFactory {
    private readonly definitionsByClass = new WeakMap<Function, EntityFactoryDefinition<any, any>>();

    public constructor(private readonly store: EntityStore = new FilesystemEntityStore()) { }

    public register<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(definition: EntityFactoryDefinition<TEntity, TStorage>): this {
        const normalizedDefinition = {
            ...definition,
            table: EntityTableSchema.parse(definition.table)
        };
        this.definitionsByClass.set(definition.entityClass, normalizedDefinition);
        return this;
    }

    public has(entityClass: Function): boolean {
        return this.definitionsByClass.has(entityClass);
    }

    public async create<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>, record: TStorage): Promise<TEntity> {
        const definition = this.requireDefinition(entityClass);
        const parsedRecord = definition.storageSchema.parse(record) as TStorage;
        await this.store.write(definition.table, definition.getId(parsedRecord), parsedRecord);
        return this.hydrate(entityClass, parsedRecord);
    }

    public async save<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>, record: TStorage): Promise<TEntity> {
        return this.create(entityClass, record);
    }

    public async read<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>, id: string): Promise<TEntity | undefined> {
        const definition = this.requireDefinition(entityClass);
        const record = await this.store.read(definition.table, id);
        return record === undefined ? undefined : this.hydrate(entityClass, record);
    }

    public async find<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>): Promise<TEntity[]> {
        const definition = this.requireDefinition(entityClass);
        return (await this.store.list(definition.table)).map((record) => this.hydrate(entityClass, record));
    }

    public async remove<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>, id: string): Promise<void> {
        const definition = this.requireDefinition(entityClass);
        await this.store.delete(definition.table, id);
    }

    public hydrate<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>, record: unknown): TEntity {
        const definition = this.requireDefinition(entityClass);
        return new entityClass(definition.storageSchema.parse(record) as TStorage);
    }

    private requireDefinition<
        TEntity extends Entity<TStorage, string>,
        TStorage extends object
    >(entityClass: EntityConstructor<TEntity, TStorage>): EntityFactoryDefinition<TEntity, TStorage> {
        const definition = this.definitionsByClass.get(entityClass);
        if (!definition) {
            throw new Error(`Entity '${entityClass.entityName}' is not registered in the Entity factory.`);
        }
        return definition as EntityFactoryDefinition<TEntity, TStorage>;
    }
}

let defaultEntityFactory: EntityFactory | undefined;

export function getDefaultEntityFactory(): EntityFactory {
    defaultEntityFactory ??= new EntityFactory();
    return defaultEntityFactory;
}

export function setDefaultEntityFactory(factory: EntityFactory): void {
    defaultEntityFactory = factory;
}