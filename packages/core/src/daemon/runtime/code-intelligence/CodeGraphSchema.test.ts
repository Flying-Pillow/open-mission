import { Surreal } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { describe, expect, it } from 'vitest';
import { compileCodeGraphSurql } from './CodeGraphSchema.js';

type TableInfo = {
    fields?: Record<string, string>;
    indexes?: Record<string, string>;
};

describe('Code graph schema', () => {
    it('compiles code graph physical storage schemas into DDL accepted by embedded SurrealDB', async () => {
        const db = new Surreal({ engines: createNodeEngines() });
        await db.connect('mem://');
        await db.use({ namespace: 'mission_code_graph_schema_test', database: 'code_intelligence' });

        try {
            await db.query(compileCodeGraphSurql());

            const [snapshotInfo] = await db.query<TableInfo[]>('INFO FOR TABLE code_index_snapshot;');
            const [fileInfo] = await db.query<TableInfo[]>('INFO FOR TABLE code_file;');
            const [symbolInfo] = await db.query<TableInfo[]>('INFO FOR TABLE code_symbol;');
            const [relationInfo] = await db.query<TableInfo[]>('INFO FOR TABLE code_relation;');

            expect(Object.keys(snapshotInfo.fields ?? {})).toEqual(expect.arrayContaining([
                'codeRootId',
                'rootFingerprint',
                'status'
            ]));
            expect(Object.keys(fileInfo.indexes ?? {})).toEqual(expect.arrayContaining([
                'code_file_index_path_idx'
            ]));
            expect(Object.keys(symbolInfo.indexes ?? {})).toEqual(expect.arrayContaining([
                'code_symbol_index_name_idx',
                'code_symbol_name_idx'
            ]));
            expect(Object.keys(relationInfo.fields ?? {})).toEqual(expect.arrayContaining([
                'fromFilePath',
                'kind',
                'target'
            ]));
        } finally {
            await db.close();
        }
    });
});