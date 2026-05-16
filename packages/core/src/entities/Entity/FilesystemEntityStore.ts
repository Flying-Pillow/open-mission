import * as path from 'node:path';
import type { z } from 'zod/v4';
import { JsonFileAdapter } from '../../lib/formats/JsonFileAdapter.js';
import { EntityStorageSchema, EntityTableSchema, SelectSchema, type EntityStorageType, type WhereType } from './EntitySchema.js';
import type { EntityFindResult, EntityFindSelection, FactoryStore } from '../../lib/factory.js';

export class FilesystemEntityStore implements FactoryStore {
    public constructor(
        private readonly rootPath = path.join(getOpenMissionRuntimeDirectoryPath(), 'entities'),
        private readonly jsonFiles = new JsonFileAdapter()
    ) { }

    public async create<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        const records = await this.readTable(table);
        records[readEntityId(record)] = record;
        await this.writeTable(table, records);
        return record;
    }

    public async save<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        return this.create(table, record);
    }

    public async relate<TStorage extends EntityStorageType>(
        table: string,
        record: TStorage
    ): Promise<TStorage> {
        return this.create(table, record);
    }

    public async read<TStorage extends object>(
        table: string,
        id: string
    ): Promise<TStorage | undefined> {
        return (await this.readTable(table))[id] as TStorage | undefined;
    }

    public async find<TStorage extends object>(
        table: string,
        _storageSchema: z.ZodType<TStorage>,
        select?: EntityFindSelection
    ): Promise<EntityFindResult<TStorage>> {
        const normalizedSelect = SelectSchema.parse(select ?? {});
        let records = Object.values(await this.readTable(table)) as TStorage[];

        if (normalizedSelect.from && normalizedSelect.from.includes(':')) {
            records = records.filter((record) => readEntityId(record) === normalizedSelect.from);
        }

        if (normalizedSelect.where) {
            const clauses = Array.isArray(normalizedSelect.where)
                ? normalizedSelect.where
                : [normalizedSelect.where];
            records = records.filter((record) => clauses.every((clause) => matchesWhereClause(record, clause)));
        }

        const total = records.length;
        const start = normalizedSelect.start ?? 0;
        const limit = normalizedSelect.limit ?? total;
        const entities = records.slice(start, start + limit);

        return {
            count: entities.length,
            start,
            total,
            entities
        };
    }

    public async remove(table: string, id: string): Promise<void> {
        const records = await this.readTable(table);
        if (!(id in records)) {
            return;
        }
        delete records[id];
        await this.writeTable(table, records);
    }

    private async readTable(table: string): Promise<Record<string, unknown>> {
        return await this.jsonFiles.readObject(this.getTablePath(table)) ?? {};
    }

    private async writeTable(table: string, records: Record<string, unknown>): Promise<void> {
        await this.jsonFiles.writeObject(this.getTablePath(table), records);
    }

    private getTablePath(table: string): string {
        return path.join(this.rootPath, `${EntityTableSchema.parse(table)}.json`);
    }
}

function getOpenMissionRuntimeDirectoryPath(): string {
    const configuredPath = process.env['OPEN_MISSION_CONFIG_DIR']?.trim();
    const configDirectory = configuredPath
        ? path.resolve(configuredPath)
        : path.join(process.env['XDG_CONFIG_HOME']?.trim() || path.join(process.env['HOME'] || process.cwd(), '.config'), 'open-mission');
    return path.join(configDirectory, 'runtime');
}

function readEntityId(record: unknown): string {
    return EntityStorageSchema.shape.id.parse((record as EntityStorageType).id);
}

function matchesWhereClause(record: unknown, clause: string | WhereType): boolean {
    if (typeof clause === 'string') {
        return true;
    }

    const actual = readFieldValue(record, clause.field);
    const expected = clause.value;
    const operator = clause.operator ?? '=';

    switch (operator) {
        case '=':
        case '==':
        case 'IS':
            return actual === expected;
        case '!=':
        case 'IS NOT':
            return actual !== expected;
        case '>':
            return compareValues(actual, expected) > 0;
        case '>=':
            return compareValues(actual, expected) >= 0;
        case '<':
            return compareValues(actual, expected) < 0;
        case '<=':
            return compareValues(actual, expected) <= 0;
        case 'CONTAINS':
            return Array.isArray(actual)
                ? actual.includes(expected)
                : typeof actual === 'string' && typeof expected === 'string'
                    ? actual.includes(expected)
                    : false;
        case 'CONTAINSNOT':
            return Array.isArray(actual)
                ? !actual.includes(expected)
                : typeof actual === 'string' && typeof expected === 'string'
                    ? !actual.includes(expected)
                    : true;
        default:
            return true;
    }
}

function compareValues(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }
    if (typeof left === 'string' && typeof right === 'string') {
        return left.localeCompare(right);
    }
    return 0;
}

function readFieldValue(record: unknown, fieldPath: string): unknown {
    return fieldPath.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return undefined;
        }

        return (current as Record<string, unknown>)[segment];
    }, record);
}