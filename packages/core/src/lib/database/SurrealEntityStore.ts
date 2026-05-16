import { compileModel, compileSelectQuery, type CompiledSurrealModel, type SelectQuery, type WhereClause } from '@flying-pillow/zod-surreal';
import type { z } from 'zod/v4';
import { Table } from 'surrealdb';
import { EntityStorageSchema, EntityTableSchema, type EntityStorageType, SelectSchema, type SelectType, type WhereType } from '../../entities/Entity/EntitySchema.js';
import type { EntityFindResult, EntityFindSelection, FactoryStore } from '../factory.js';
import {
    normalizeSurrealResult,
    SurrealDatabase,
    toSurrealRecordId
} from './SurrealDatabase.js';

export class SurrealEntityStore implements FactoryStore {
    public constructor(private readonly database: SurrealDatabase) { }

    public async create<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        const db = await this.database.getClient();
        return toEntityRecord(normalizeSurrealResult(await db
            .create(toSurrealRecordId(table, readEntityId(record)))
            .content(toSurrealRecordContent(record))
            .json())) as TStorage;
    }

    public async save<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        const db = await this.database.getClient();
        return toEntityRecord(normalizeSurrealResult(await db
            .upsert(toSurrealRecordId(table, readEntityId(record)))
            .content(toSurrealRecordContent(record))
            .json())) as TStorage;
    }

    public async relate<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        const normalizedTable = EntityTableSchema.parse(table);
        const [rows = []] = await this.database.query<unknown[]>(
            `RELATE $in -> ${normalizedTable} -> $out CONTENT $content RETURN AFTER;`,
            {
                in: toSurrealEntityRecordId(readRelationEndpoint(record, 'in')),
                out: toSurrealEntityRecordId(readRelationEndpoint(record, 'out')),
                content: toSurrealRelationContent(record)
            }
        );
        const related = rows[0];
        if (related === undefined) {
            throw new Error(`Failed to relate record in table '${normalizedTable}'.`);
        }

        return toEntityRecord(related) as TStorage;
    }

    public async read<TStorage extends object>(
        table: string,
        id: string
    ): Promise<TStorage | undefined> {
        const db = await this.database.getClient();
        const record = await db.select(toSurrealRecordId(table, id)).json();
        return record === undefined ? undefined : toEntityRecord(record) as TStorage;
    }

    public async find<TStorage extends object>(
        table: string,
        storageSchema: z.ZodType<TStorage>,
        select?: EntityFindSelection
    ): Promise<EntityFindResult<TStorage>> {
        const normalizedSelect = normalizeSelect(table, storageSchema, select);
        if (isTableScan(normalizedSelect)) {
            const db = await this.database.getClient();
            const entities = normalizeSurrealResult<unknown[]>(
                await db.select(new Table(EntityTableSchema.parse(table))).json()
            ).map((record) => toEntityRecord(record) as TStorage);
            return {
                count: entities.length,
                start: 0,
                total: entities.length,
                entities
            };
        }

        const model = getCompiledModel(table, storageSchema);
        const compiled = compileSelectQuery(toSelectQuery(normalizedSelect), model.fields, {
            defaultTable: table,
            isRecordIdString: () => false,
            toRecordId: (value) => toSurrealRecordId(value.split(':')[0]!, value.slice(value.indexOf(':') + 1))
        });
        const [records = []] = await this.database.query<unknown[]>(compiled.query, compiled.bindings);
        const entities = records.map((record) => toEntityRecord(record) as TStorage);
        const total = normalizedSelect.pagination
            ? await readTotal(this.database, table, model, normalizedSelect)
            : entities.length;

        return {
            count: entities.length,
            start: normalizedSelect.start ?? 0,
            total,
            entities
        };
    }

    public async remove(table: string, id: string): Promise<void> {
        const db = await this.database.getClient();
        await db.delete(toSurrealRecordId(table, id)).json();
    }
}

const compiledModels = new WeakMap<object, CompiledSurrealModel>();

function getCompiledModel<TStorage extends object>(table: string, storageSchema: z.ZodType<TStorage>): CompiledSurrealModel {
    const cacheKey = storageSchema as object;
    const cached = compiledModels.get(cacheKey);
    if (cached) {
        return cached;
    }

    const compiled = compileModel({
        name: table,
        schema: storageSchema as never,
        storageSchema: storageSchema as never,
        dataSchema: storageSchema as never
    });
    compiledModels.set(cacheKey, compiled);
    return compiled;
}

function normalizeSelect<TStorage extends object>(
    table: string,
    storageSchema: z.ZodType<TStorage>,
    select?: EntityFindSelection
): SelectType {
    const parsed = SelectSchema.parse(select ?? {});
    const model = getCompiledModel(table, storageSchema);
    const omitted = toStringArray(parsed.omit);
    const selectClause = parsed.select?.trim()
        ? parsed.select.trim()
        : omitted.length > 0
            ? resolveSelectClause(model, omitted)
            : undefined;
    const group = parsed.group?.trim()
        ? parsed.group.trim()
        : parsed.groupBy
            ? toGroupClause(parsed.groupBy)
            : undefined;

    return {
        ...parsed,
        ...(selectClause ? { select: selectClause } : {}),
        ...(group ? { group } : {})
    };
}

function isTableScan(select: SelectType): boolean {
    return !select.from
        && !select.where
        && !select.orderBy
        && !select.group
        && !select.groupBy
        && !select.limit
        && !select.start
        && !select.fetch
        && !select.select
        && !select.omit
        && !select.pagination;
}

function toStringArray(value: string | string[] | null | undefined): string[] {
    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function resolveSelectClause(model: CompiledSurrealModel, omitted: string[]): string | undefined {
    const omittedFields = new Set(omitted);
    const selectedFields = Object.values(model.fields)
        .filter((field) => field.storage && !omittedFields.has(field.name))
        .map((field) => field.name);
    return selectedFields.length > 0 ? selectedFields.join(', ') : undefined;
}

function toGroupClause(groupBy: SelectType['groupBy']): string | undefined {
    if (!groupBy) {
        return undefined;
    }

    const groups = Array.isArray(groupBy) ? groupBy : [groupBy];
    return groups.map((item) => item.field).join(', ');
}

function toSelectQuery(select: SelectType): SelectQuery {
    const query: SelectQuery = {};

    if (select.select !== undefined) {
        query.select = select.select ?? null;
    }
    if (select.from !== undefined) {
        query.from = select.from ?? null;
    }
    if (select.where !== undefined) {
        const where = toCompiledWhere(select.where);
        if (where !== undefined) {
            query.where = where;
        }
    }
    if (select.orderBy !== undefined) {
        const orderBy = toCompiledOrderBy(select.orderBy);
        if (orderBy !== undefined) {
            query.orderBy = orderBy;
        }
    }
    if (select.group !== undefined) {
        query.group = select.group ?? null;
    }
    if (select.limit !== undefined) {
        query.limit = select.limit ?? null;
    }
    if (select.start !== undefined) {
        query.start = select.start ?? null;
    }
    if (select.fetch !== undefined) {
        query.fetch = select.fetch ?? null;
    }

    return query;
}

function toCompiledWhere(where: SelectType['where']): SelectQuery['where'] | undefined {
    if (where === undefined) {
        return undefined;
    }
    if (where === null) {
        return null;
    }
    if (Array.isArray(where)) {
        return where.map((clause) => toCompiledWhereClause(clause));
    }
    return toCompiledWhereClause(where);
}

function toCompiledWhereClause(clause: string | WhereType): string | WhereClause {
    if (typeof clause === 'string') {
        return clause;
    }

    return {
        field: clause.field,
        ...(clause.operator ? { operator: clause.operator } : {}),
        value: clause.value ?? null
    };
}

function toCompiledOrderBy(orderBy: SelectType['orderBy']): SelectQuery['orderBy'] | undefined {
    if (orderBy === undefined) {
        return undefined;
    }
    if (orderBy === null) {
        return null;
    }

    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    const normalized: Array<{ field: string; direction?: 'ASC' | 'DESC' | null }> = clauses.map((clause) => ({
        field: clause.field,
        ...(clause.direction !== undefined ? { direction: clause.direction ?? null } : {})
    }));
    return Array.isArray(orderBy) ? normalized : normalized[0]!;
}

async function readTotal(
    database: SurrealDatabase,
    table: string,
    model: CompiledSurrealModel,
    select: SelectType
): Promise<number> {
    const compiled = compileSelectQuery(toSelectQuery({
        from: select.from,
        where: select.where,
        group: select.group
    }), model.fields, {
        defaultTable: table,
        isRecordIdString: () => false,
        toRecordId: (value) => toSurrealRecordId(value.split(':')[0]!, value.slice(value.indexOf(':') + 1))
    });
    const countQuery = compiled.query.replace(/^SELECT \*/u, 'SELECT count() AS total');
    const [rows = []] = await database.query<Array<{ total?: number }>>(countQuery, compiled.bindings);

    if (rows.length === 1 && typeof rows[0]?.total === 'number') {
        return rows[0].total;
    }

    return rows.reduce((sum, row) => sum + (typeof row.total === 'number' ? row.total : 0), 0);
}

function toSurrealRecordContent(record: unknown): Record<string, unknown> {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('SurrealEntityStore can only write object records.');
    }

    const content = { ...(record as Record<string, unknown>) };
    delete content['id'];
    return content;
}

function toSurrealRelationContent(record: unknown): Record<string, unknown> {
    const content = toSurrealRecordContent(record);
    delete content['in'];
    delete content['out'];
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

function readEntityId(record: unknown): string {
    return EntityStorageSchema.shape.id.parse((record as EntityStorageType).id);
}

function readRelationEndpoint(record: unknown, field: 'in' | 'out'): string {
    const value = (record as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Relation record is missing '${field}' endpoint id.`);
    }
    return value;
}

function toSurrealEntityRecordId(id: string) {
    const separatorIndex = id.indexOf(':');
    if (separatorIndex < 0) {
        throw new Error(`Expected canonical entity id, received '${id}'.`);
    }

    return toSurrealRecordId(id.slice(0, separatorIndex), id.slice(separatorIndex + 1));
}