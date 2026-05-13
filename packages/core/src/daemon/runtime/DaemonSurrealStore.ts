import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createNodeEngines } from '@surrealdb/node';
import { Surreal } from 'surrealdb';
import { Repository } from '../../entities/Repository/Repository.js';

export type DaemonSurrealStoreStatus = {
    available: boolean;
    engine: 'mem' | 'surrealkv';
    namespace: string;
    database: string;
    storagePath?: string;
    connectedAt?: string;
    detail?: string;
};

export type DaemonSurrealStoreOptions = {
    namespace?: string;
    database?: string;
    endpoint?: 'mem://' | `surrealkv://${string}`;
    storagePath?: string;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export class DaemonSurrealStore {
    private readonly namespace: string;
    private readonly database: string;
    private readonly endpoint: 'mem://' | `surrealkv://${string}`;
    private readonly engine: DaemonSurrealStoreStatus['engine'];
    private readonly storagePath: string | undefined;
    private readonly logger: DaemonSurrealStoreOptions['logger'];
    private db: Surreal | undefined;
    private status: DaemonSurrealStoreStatus;

    public constructor(options: DaemonSurrealStoreOptions = {}) {
        this.namespace = options.namespace?.trim() || 'mission_daemon';
        this.database = options.database?.trim() || 'mission';
        this.endpoint = options.endpoint ?? 'mem://';
        this.engine = this.endpoint === 'mem://' ? 'mem' : 'surrealkv';
        this.storagePath = options.storagePath?.trim();
        this.logger = options.logger;
        this.status = {
            available: false,
            engine: this.engine,
            namespace: this.namespace,
            database: this.database,
            ...(this.storagePath ? { storagePath: this.storagePath } : {}),
            detail: 'SurrealDB runtime store has not started.'
        };
    }

    public static forCodeRoot(input: {
        rootPath: string;
        namespace?: string;
        database?: string;
        logger?: DaemonSurrealStoreOptions['logger'];
    }): DaemonSurrealStore {
        const storagePath = resolveDaemonSurrealStorePath(input.rootPath);
        return new DaemonSurrealStore({
            namespace: input.namespace,
            database: input.database ?? 'code_intelligence',
            endpoint: `surrealkv://${storagePath}`,
            storagePath,
            logger: input.logger
        });
    }

    public static inMemory(options: Omit<DaemonSurrealStoreOptions, 'endpoint'> = {}): DaemonSurrealStore {
        return new DaemonSurrealStore({ ...options, endpoint: 'mem://' });
    }

    public async start(): Promise<void> {
        if (this.db) {
            return;
        }

        if (this.storagePath) {
            await fs.mkdir(this.storagePath, { recursive: true });
        }
        const db = new Surreal({ engines: createNodeEngines() });
        await db.connect(this.endpoint);
        await db.use({ namespace: this.namespace, database: this.database });
        this.db = db;
        this.status = {
            available: true,
            engine: this.engine,
            namespace: this.namespace,
            database: this.database,
            ...(this.storagePath ? { storagePath: this.storagePath } : {}),
            connectedAt: new Date().toISOString()
        };
        this.logger?.debug('Daemon SurrealDB runtime store started.', this.status);
    }

    public async stop(): Promise<void> {
        if (!this.db) {
            return;
        }
        await this.db.close();
        this.db = undefined;
        this.status = {
            available: false,
            engine: this.engine,
            namespace: this.namespace,
            database: this.database,
            ...(this.storagePath ? { storagePath: this.storagePath } : {}),
            detail: 'SurrealDB runtime store is stopped.'
        };
        this.logger?.debug('Daemon SurrealDB runtime store stopped.', this.status);
    }

    public readStatus(): DaemonSurrealStoreStatus {
        return { ...this.status };
    }

    public async query<TResult = unknown>(statement: string, bindings: Record<string, unknown> = {}): Promise<TResult[]> {
        if (!this.db) {
            throw new Error('Daemon SurrealDB runtime store is not available.');
        }
        return this.db.query<TResult[]>(statement, bindings);
    }
}

export function resolveDaemonSurrealStorePath(rootPath: string): string {
    const normalizedRootPath = path.resolve(rootPath.trim());
    if (!normalizedRootPath) {
        throw new Error('DaemonSurrealStore requires a repository or worktree root path.');
    }
    return path.join(Repository.getMissionDirectoryPath(normalizedRootPath), 'runtime');
}