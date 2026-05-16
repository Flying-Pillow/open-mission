import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordId, Surreal, jsonify } from 'surrealdb';
import { EntityTableSchema } from '../../entities/Entity/EntitySchema.js';

export type RemoteSurrealEndpoint = `${'ws' | 'wss' | 'http' | 'https'}://${string}`;
export type SurrealDatabaseEndpoint = RemoteSurrealEndpoint;

export const defaultSurrealEndpoint = 'ws://open-mission-surrealdb:8000' as const;
export const defaultSurrealUsername = 'root' as const;
export const defaultSurrealPassword = 'root' as const;

export type SurrealDatabaseStatus = {
    available: boolean;
    engine: 'remote';
    namespace: string;
    database: string;
    schemaDirectory: string;
    connectedAt?: string;
    detail?: string;
};

export type SurrealDatabaseOptions = {
    namespace?: string;
    database?: string;
    endpoint?: SurrealDatabaseEndpoint;
    username?: string;
    password?: string;
    schemaDirectory?: string;
    provisionOnStart?: boolean;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export type SharedSurrealDatabaseOptions = SurrealDatabaseOptions & {
    shareKey?: string;
};

const sharedDatabases = new Map<string, SurrealDatabase>();

export class SurrealDatabase {
    private readonly shareKey: string | undefined;
    private readonly namespace: string;
    private readonly database: string;
    private readonly endpoint: SurrealDatabaseEndpoint;
    private readonly username: string | undefined;
    private readonly password: string | undefined;
    private readonly schemaDirectory: string;
    private readonly provisionOnStart: boolean;
    private readonly logger: SurrealDatabaseOptions['logger'];
    private db: Surreal | undefined;
    private startPromise: Promise<Surreal> | undefined;
    private status: SurrealDatabaseStatus;

    public constructor(options: SharedSurrealDatabaseOptions) {
        this.shareKey = options.shareKey;
        this.namespace = options.namespace?.trim() || 'flying_pillow';
        this.database = options.database?.trim() || 'open_mission';
        this.endpoint = options.endpoint ?? resolveExternalEndpoint();
        this.username = options.username?.trim() || undefined;
        this.password = options.password?.trim() || undefined;
        this.schemaDirectory = options.schemaDirectory ?? resolveDefaultSurqlSchemaDirectory();
        this.provisionOnStart = options.provisionOnStart ?? true;
        this.logger = options.logger;
        this.status = {
            available: false,
            engine: 'remote',
            namespace: this.namespace,
            database: this.database,
            schemaDirectory: this.schemaDirectory,
            detail: 'SurrealDB database has not started.'
        };
    }

    public static forExternal(input: {
        endpoint?: RemoteSurrealEndpoint;
        namespace?: string;
        database?: string;
        username?: string;
        password?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    } = {}): SurrealDatabase {
        return new SurrealDatabase({
            endpoint: input.endpoint ?? resolveExternalEndpoint(),
            username: input.username?.trim() || resolveExternalUsername(),
            password: input.password?.trim() || resolveExternalPassword(),
            ...(input.namespace ? { namespace: input.namespace } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {}),
            ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
            ...(input.logger ? { logger: input.logger } : {})
        });
    }

    public static sharedForExternal(input: {
        endpoint?: RemoteSurrealEndpoint;
        namespace?: string;
        database?: string;
        username?: string;
        password?: string;
        schemaDirectory?: string;
        provisionOnStart?: boolean;
        logger?: SurrealDatabaseOptions['logger'];
    } = {}): SurrealDatabase {
        return getOrCreateSharedDatabase({
            endpoint: input.endpoint ?? resolveExternalEndpoint(),
            username: input.username?.trim() || resolveExternalUsername(),
            password: input.password?.trim() || resolveExternalPassword(),
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
            engine: 'remote',
            namespace: this.namespace,
            database: this.database,
            schemaDirectory: this.schemaDirectory,
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
        const db = new Surreal();
        try {
            await db.connect(this.endpoint);
            await db.use({ namespace: this.namespace, database: this.database });
            if (this.username || this.password) {
                if (!this.username || !this.password) {
                    throw new Error('Remote SurrealDB authentication requires both username and password.');
                }
                await db.signin({ username: this.username, password: this.password });
            }
            this.db = db;
            this.status = {
                available: true,
                engine: 'remote',
                namespace: this.namespace,
                database: this.database,
                schemaDirectory: this.schemaDirectory,
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
    const namespace = options.namespace?.trim() || 'flying_pillow';
    const database = options.database?.trim() || 'open_mission';
    const endpoint = options.endpoint ?? resolveExternalEndpoint();
    const username = options.username?.trim() || undefined;
    const password = options.password?.trim() || undefined;
    const schemaDirectory = options.schemaDirectory ?? resolveDefaultSurqlSchemaDirectory();
    const provisionOnStart = options.provisionOnStart ?? true;
    return JSON.stringify({ endpoint, namespace, database, username, password, schemaDirectory, provisionOnStart });
}

function resolveExternalEndpoint(): RemoteSurrealEndpoint {
    return (process.env['OPEN_MISSION_SURREALDB_ENDPOINT']?.trim() as RemoteSurrealEndpoint | undefined)
        ?? defaultSurrealEndpoint;
}

function resolveExternalUsername(): string {
    return process.env['OPEN_MISSION_SURREALDB_USERNAME']?.trim() || defaultSurrealUsername;
}

function resolveExternalPassword(): string {
    return process.env['OPEN_MISSION_SURREALDB_PASSWORD']?.trim() || defaultSurrealPassword;
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
    return path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');
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