import {
    resolveRepositoryDatabasePath,
    SurrealDatabase,
    type SurrealDatabaseOptions,
    type SurrealDatabaseStatus
} from '../../lib/database/SurrealDatabase.js';

export type DaemonSurrealStoreStatus = SurrealDatabaseStatus;

export type DaemonSurrealStoreOptions = {
    databaseDriver?: SurrealDatabase;
    storagePath?: string;
    endpoint?: SurrealDatabaseOptions['endpoint'];
    schemaDirectory?: string;
    provisionOnStart?: boolean;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export class DaemonSurrealStore {
    private readonly databaseDriver: SurrealDatabase;

    public constructor(options: DaemonSurrealStoreOptions = {}) {
        this.databaseDriver = options.databaseDriver ?? new SurrealDatabase({
            ...(options.endpoint ? { endpoint: options.endpoint } : options.storagePath ? {} : { endpoint: 'mem://' }),
            ...(options.storagePath ? { storagePath: options.storagePath } : {}),
            ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}),
            ...(options.provisionOnStart !== undefined ? { provisionOnStart: options.provisionOnStart } : {}),
            ...(options.logger ? { logger: options.logger } : {})
        });
    }

    public static forCodeRoot(input: {
        rootPath: string;
        logger?: DaemonSurrealStoreOptions['logger'];
    }): DaemonSurrealStore {
        return new DaemonSurrealStore({
            databaseDriver: SurrealDatabase.sharedForOwner({
                ownerEntity: 'Repository',
                repositoryRootPath: input.rootPath,
                ...(input.logger ? { logger: input.logger } : {})
            })
        });
    }

    public static inMemory(options: Omit<DaemonSurrealStoreOptions, 'endpoint'> = {}): DaemonSurrealStore {
        return new DaemonSurrealStore({
            databaseDriver: options.databaseDriver ?? SurrealDatabase.inMemory({
                ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}),
                ...(options.provisionOnStart !== undefined ? { provisionOnStart: options.provisionOnStart } : {}),
                ...(options.logger ? { logger: options.logger } : {})
            })
        });
    }

    public async start(): Promise<void> {
        await this.databaseDriver.start();
    }

    public async stop(): Promise<void> {
        await this.databaseDriver.stop();
    }

    public readStatus(): DaemonSurrealStoreStatus {
        return this.databaseDriver.readStatus();
    }

    public async query<TResult = unknown>(statement: string, bindings: Record<string, unknown> = {}): Promise<TResult[]> {
        return this.databaseDriver.query<TResult>(statement, bindings);
    }
}

export function resolveDaemonSurrealStorePath(rootPath: string): string {
    return resolveRepositoryDatabasePath(rootPath);
}