import { EntityFactory, FilesystemEntityStore, setDefaultEntityFactory } from '../entities/Entity/EntityFactory.js';
import type { EntityStore } from '../entities/Entity/EntitySchema.js';
import { AgentExecution } from '../entities/AgentExecution/AgentExecution.js';
import {
    agentExecutionEntityName,
    agentExecutionTableName,
    AgentExecutionStorageSchema,
    type AgentExecutionStorageType
} from '../entities/AgentExecution/AgentExecutionSchema.js';
import {
    SurrealDatabase,
    type SurrealDatabaseOptions,
    type SurrealDatabaseOwnerLocation
} from './database/SurrealDatabase.js';
import { SurrealEntityStore } from './database/SurrealEntityStore.js';

export type EntityFactoryBackend = 'surreal' | 'filesystem';

export type CreateEntityFactoryOptions = {
    backend?: EntityFactoryBackend;
    databasePath?: string;
    ownerLocation?: SurrealDatabaseOwnerLocation;
    database?: SurrealDatabase;
    store?: EntityStore;
    namespace?: string;
    databaseName?: string;
    schemaDirectory?: string;
    provisionOnStart?: boolean;
    logger?: SurrealDatabaseOptions['logger'];
};

export function createEntityFactory(options: CreateEntityFactoryOptions = {}): EntityFactory {
    if (options.store) {
        return registerEntityDefinitions(new EntityFactory(options.store));
    }

    if ((options.backend ?? 'surreal') === 'filesystem') {
        return createFilesystemEntityFactory();
    }

    return createSurrealEntityFactory(options);
}

export function createSurrealEntityFactory(options: Omit<CreateEntityFactoryOptions, 'backend' | 'store'>): EntityFactory {
    const database = options.database ?? createSurrealDatabase(options);
    return registerEntityDefinitions(new EntityFactory(new SurrealEntityStore(database)));
}

export function createFilesystemEntityFactory(): EntityFactory {
    return registerEntityDefinitions(new EntityFactory(new FilesystemEntityStore()));
}

export function configureDefaultEntityFactory(options: CreateEntityFactoryOptions = {}): EntityFactory {
    const factory = createEntityFactory(options);
    setDefaultEntityFactory(factory);
    return factory;
}

export function registerEntityDefinitions(factory: EntityFactory): EntityFactory {
    return factory.register<AgentExecution, AgentExecutionStorageType>({
        entityName: agentExecutionEntityName,
        table: agentExecutionTableName,
        entityClass: AgentExecution,
        storageSchema: AgentExecutionStorageSchema,
        getId: (record) => record.id
    });
}

function createSurrealDatabase(options: Omit<CreateEntityFactoryOptions, 'backend' | 'store'>): SurrealDatabase {
    if (options.databasePath) {
        return SurrealDatabase.sharedForStoragePath({
            storagePath: options.databasePath,
            ...(options.namespace ? { namespace: options.namespace } : {}),
            ...(options.databaseName ? { database: options.databaseName } : {}),
            ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}),
            ...(options.provisionOnStart !== undefined ? { provisionOnStart: options.provisionOnStart } : {}),
            ...(options.logger ? { logger: options.logger } : {})
        });
    }

    if (!options.ownerLocation) {
        throw new Error('createSurrealEntityFactory requires databasePath or ownerLocation when no SurrealDatabase is provided.');
    }

    return SurrealDatabase.sharedForOwner({
        ...options.ownerLocation,
        ...(options.namespace ? { namespace: options.namespace } : {}),
        ...(options.databaseName ? { database: options.databaseName } : {}),
        ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}),
        ...(options.provisionOnStart !== undefined ? { provisionOnStart: options.provisionOnStart } : {}),
        ...(options.logger ? { logger: options.logger } : {})
    });
}