import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeEngines } from '@surrealdb/node';
import { RecordId, Surreal, jsonify } from 'surrealdb';
import { EntityTableSchema } from '../../entities/Entity/EntitySchema.js';

export type SurrealDatabaseStatus = {
    available: boolean;
    engine: 'mem' | 'surrealkv';
    namespace: string;
    database: string;
    storagePath?: string;
    schemaDirectory: string;
    connectedAt?: string;
    detail?: string;
};

export type SurrealDatabaseOptions = {
    namespace?: string;
    database?: string;
    storagePath?: string;
    endpoint?: 'mem://' | `surrealkv://${string}`;
    schemaDirectory?: string;
    provisionOnStart?: boolean;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export type SharedSurrealDatabaseOptions = SurrealDatabaseOptions & {
    shareKey?: string;
};

export type SurrealDatabaseOwnerLocation =
    | {
        ownerEntity: 'System';
        configRootPath?: string;
    }
    | {
        ownerEntity: 'Repository';
        repositoryRootPath: string;
    }
    | {
        ownerEntity: 'Mission' | 'Task' | 'Artifact';
        missionRootPath: string;
        missionId: string;
    };

export const openMissionRepositoryDirectoryName = '.open-mission' as const;

const sharedDatabases = new Map<string, SurrealDatabase>();

export class SurrealDatabase {
    private readonly shareKey: string | undefined;
    private readonly namespace: string;
    private readonly database: string;
    private readonly storagePath: string | undefined;
    private readonly endpoint: 'mem://' | `surrealkv://${string}`;
    private readonly engine: SurrealDatabaseStatus['engine'];
    private readonly schemaDirectory: string;
    private readonly provisionOnStart: boolean;
    private readonly logger: SurrealDatabaseOptions['logger'];
    private db: Surreal | undefined;
    private startPromise: Promise<Surreal> | undefined;
    private status: SurrealDatabaseStatus;

    public constructor(options: SharedSurrealDatabaseOptions) {
        this.shareKey = options.shareKey;
        this.namespace = options.namespace?.trim() || 'open_mission';
        this.database = options.database?.trim() || 'mission';
        this.storagePath = resolveStoragePath(options);
        this.endpoint = options.endpoint ?? `surrealkv://${requireStoragePath(this.storagePath)}`;
        this.engine = this.endpoint === 'mem://' ? 'mem' : 'surrealkv';
        this.schemaDirectory = options.schemaDirectory ?? resolveDefaultSurqlSchemaDirectory();
        this.provisionOnStart = options.provisionOnStart ?? true;
        this.logger = options.logger;
        this.status = {
            available: false,
            engine: this.engine,
            namespace: this.namespace,
            database: this.database,
            schemaDirectory: this.schemaDirectory,
            ...(this.storagePath ? { storagePath: this.storagePath } : {}),
            detail: 'SurrealDB database has not started.'
        };
    }

    public static forStoragePath(input: {
        storagePath: string;
        namespace?: string;
        database?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    }): SurrealDatabase {
        return new SurrealDatabase({
            storagePath: input.storagePath,
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public static sharedForStoragePath(input: {
        storagePath: string;
        namespace?: string;
        database?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    }): SurrealDatabase {
        return getOrCreateSharedDatabase({
            storagePath: input.storagePath,
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public static inMemory(input: {
        namespace?: string;
        database?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    } = {}): SurrealDatabase {
        return new SurrealDatabase({
            endpoint: 'mem://',
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public static forOwner(input: SurrealDatabaseOwnerLocation & {
        namespace?: string;
        database?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    }): SurrealDatabase {
        return SurrealDatabase.forStoragePath({
            storagePath: resolveOwnerDatabasePath(input),
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public static sharedForOwner(input: SurrealDatabaseOwnerLocation & {
        namespace?: string;
        database?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    }): SurrealDatabase {
        return SurrealDatabase.sharedForStoragePath({
            storagePath: resolveOwnerDatabasePath(input),
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public async start(): Promise<void> {
        await this.getClient();
    }

    public async getClient(): Promise<Surreal> {
        if (this.db) {
            return this.db;
        }

        this.startPromise ??= this.open();
        return this.startPromise;
    }

    public async stop(): Promise<void> {
        const db = this.db;
        this.db = undefined;
        this.startPromise = undefined;
        if (db) {
            await db.close();
        }
        if (this.shareKey && sharedDatabases.get(this.shareKey) === this) {
            sharedDatabases.delete(this.shareKey);
        }
        this.status = {
            available: false,
            engine: this.engine,
            namespace: this.namespace,
            database: this.database,
            schemaDirectory: this.schemaDirectory,
            ...(this.storagePath ? { storagePath: this.storagePath } : {}),
            detail: 'SurrealDB database is stopped.'
        };
        this.logger?.debug('Open Mission SurrealDB database stopped.', this.status);
    }

    public readStatus(): SurrealDatabaseStatus {
        return { ...this.status };
    }

    public async query<TResult = unknown>(statement: string, bindings: Record<string, unknown> = {}): Promise<TResult[]> {
        const db = await this.getClient();
        return normalizeSurrealResult<TResult[]>(await db.query<TResult[]>(statement, bindings));
    }

    public async provisionSchemas(schemaDirectory = this.schemaDirectory): Promise<void> {
        const schemaFiles = await listSurqlFiles(schemaDirectory);
        if (schemaFiles.length === 0) {
            return;
        }

        const statements = await Promise.all(schemaFiles.map((schemaFile) => fs.readFile(schemaFile, 'utf8')));
        await this.query(statements.join('\n'));
    }

    private async open(): Promise<Surreal> {
        if (this.storagePath) {
            await fs.mkdir(this.storagePath, { recursive: true });
        }
        const db = new Surreal({ engines: createNodeEngines() });
        try {
            await db.connect(this.endpoint);
            await db.use({ namespace: this.namespace, database: this.database });
            this.db = db;
            this.status = {
                available: true,
                engine: this.engine,
                namespace: this.namespace,
                database: this.database,
                schemaDirectory: this.schemaDirectory,
                ...(this.storagePath ? { storagePath: this.storagePath } : {}),
                connectedAt: new Date().toISOString()
            };
            if (this.provisionOnStart) {
                await this.provisionSchemas();
            }
            this.logger?.debug('Open Mission SurrealDB database started.', this.status);
            return db;
        } catch (error) {
            this.db = undefined;
            this.startPromise = undefined;
            await db.close().catch(() => undefined);
            throw error;
        }
    }
}

export function resolveOwnerDatabasePath(input: SurrealDatabaseOwnerLocation): string {
    switch (input.ownerEntity) {
        case 'System': {
            return resolveSystemDatabasePath(input.configRootPath);
        }
        case 'Repository': {
            return resolveRepositoryDatabasePath(input.repositoryRootPath);
        }
        case 'Mission':
        case 'Task':
        case 'Artifact': {
            return resolveMissionOwnedDatabasePath(input.missionRootPath, input.missionId);
        }
    }
}

function getOrCreateSharedDatabase(options: SurrealDatabaseOptions): SurrealDatabase {
    const shareKey = createSharedDatabaseKey(options);
    const existing = sharedDatabases.get(shareKey);
    if (existing) {
        return existing;
    }

    const database = new SurrealDatabase({ ...options, shareKey });
    sharedDatabases.set(shareKey, database);
    return database;
}

function createSharedDatabaseKey(options: SurrealDatabaseOptions): string {
    const namespace = options.namespace?.trim() || 'open_mission';
    const database = options.database?.trim() || 'mission';
    const storagePath = resolveStoragePath(options);
    const endpoint = options.endpoint ?? `surrealkv://${requireStoragePath(storagePath)}`;
    const schemaDirectory = options.schemaDirectory ?? resolveDefaultSurqlSchemaDirectory();
    const provisionOnStart = options.provisionOnStart ?? true;
    return JSON.stringify({ endpoint, namespace, database, schemaDirectory, provisionOnStart });
}

export function resolveSystemDatabasePath(configRootPath = resolveOpenMissionConfigDirectoryPath()): string {
    return path.join(path.resolve(configRootPath), 'database');
}

export function resolveRepositoryDatabasePath(repositoryRootPath: string): string {
    return path.join(path.resolve(repositoryRootPath), openMissionRepositoryDirectoryName, 'database');
}

export function resolveMissionOwnedDatabasePath(missionRootPath: string, missionId: string): string {
    const normalizedMissionId = missionId.trim();
    if (!normalizedMissionId) {
        throw new Error('Mission-owned SurrealDB storage requires a missionId.');
    }
    return path.join(path.resolve(missionRootPath), openMissionRepositoryDirectoryName, 'missions', normalizedMissionId, 'database');
}

export function toSurrealRecordId(table: string, id: string): RecordId {
    const normalizedTable = EntityTableSchema.parse(table);
    return new RecordId(normalizedTable, resolveRecordUniqueId(normalizedTable, id));
}

export function normalizeSurrealResult<T>(value: unknown): T {
    return jsonify(value) as T;
}

function resolveRecordUniqueId(table: string, id: string): string {
    const trimmedId = id.trim();
    const separatorIndex = trimmedId.indexOf(':');
    if (separatorIndex < 0) {
        return trimmedId;
    }

    const recordTable = trimmedId.slice(0, separatorIndex);
    if (recordTable !== table) {
        throw new Error(`Record id '${id}' does not belong to SurrealDB table '${table}'.`);
    }
    return trimmedId.slice(separatorIndex + 1);
}

function resolveDefaultSurqlSchemaDirectory(): string {
    return path.dirname(fileURLToPath(import.meta.url));
}

function resolveStoragePath(options: SurrealDatabaseOptions): string | undefined {
    if (options.storagePath?.trim()) {
        return path.resolve(options.storagePath.trim());
    }
    if (options.endpoint?.startsWith('surrealkv://')) {
        return path.resolve(options.endpoint.slice('surrealkv://'.length));
    }
    return undefined;
}

function requireStoragePath(storagePath: string | undefined): string {
    if (!storagePath) {
        throw new Error('SurrealDatabase requires storagePath unless endpoint is mem://.');
    }
    return storagePath;
}

function resolveOpenMissionConfigDirectoryPath(): string {
    const configuredPath = process.env['OPEN_MISSION_CONFIG_DIR']?.trim();
    if (configuredPath) {
        return path.resolve(configuredPath);
    }

    const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
    return xdgConfigHome
        ? path.join(xdgConfigHome, 'open-mission')
        : path.join(process.env['HOME'] || process.cwd(), '.config', 'open-mission');
}

async function listSurqlFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    });

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.surql'))
        .map((entry) => path.join(directory, entry.name))
        .sort((left, right) => left.localeCompare(right));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}