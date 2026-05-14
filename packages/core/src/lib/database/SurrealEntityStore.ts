import { Table } from 'surrealdb';
import { EntityTableSchema, type EntityStore } from '../../entities/Entity/EntitySchema.js';
import {
    normalizeSurrealResult,
    SurrealDatabase,
    toSurrealRecordId
} from './SurrealDatabase.js';

export class SurrealEntityStore implements EntityStore {
    public constructor(private readonly database: SurrealDatabase) { }

    public async read(table: string, id: string): Promise<unknown | undefined> {
        const db = await this.database.getClient();
        const record = await db.select(toSurrealRecordId(table, id)).json();
        return record === undefined ? undefined : toEntityRecord(record);
    }

    public async list(table: string): Promise<unknown[]> {
        const db = await this.database.getClient();
        return normalizeSurrealResult<unknown[]>(await db.select(new Table(EntityTableSchema.parse(table))).json())
            .map(toEntityRecord);
    }

    public async write(table: string, id: string, record: unknown): Promise<void> {
        const db = await this.database.getClient();
        await db.upsert(toSurrealRecordId(table, id)).content(toSurrealRecordContent(record)).json();
    }

    public async delete(table: string, id: string): Promise<void> {
        const db = await this.database.getClient();
        await db.delete(toSurrealRecordId(table, id)).json();
    }
}

function toSurrealRecordContent(record: unknown): Record<string, unknown> {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('SurrealEntityStore can only write object records.');
    }

    const content = { ...(record as Record<string, unknown>) };
    delete content['id'];
    return content;
}

function toEntityRecord(record: unknown): unknown {
    const normalizedRecord = normalizeSurrealResult<Record<string, unknown>>(record);
    if (typeof normalizedRecord['id'] === 'string') {
        normalizedRecord['id'] = normalizeEntityId(normalizedRecord['id']);
    }
    return normalizedRecord;
}

function normalizeEntityId(id: string): string {
    const escapedIdMatch = /^([^:]+):\u27e8(.+)\u27e9$/u.exec(id);
    return escapedIdMatch ? `${escapedIdMatch[1]}:${escapedIdMatch[2]}` : id;
}