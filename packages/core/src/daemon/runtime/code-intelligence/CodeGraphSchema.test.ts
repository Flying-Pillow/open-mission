import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SurrealDatabase } from '../../../lib/database/SurrealDatabase.js';
import { compileCodeGraphSurql } from './CodeGraphSchema.js';

type TableInfo = {
    fields?: Record<string, string>;
    indexes?: Record<string, string>;
};

function tableInfo(value: unknown): TableInfo {
    if (!value || typeof value !== 'object') {
        throw new Error('Expected SurrealDB table info object.');
    }
    return value as TableInfo;
}

describe('Code graph schema', () => {
    it('compiles code graph physical storage schemas into DDL accepted by external SurrealDB', async () => {
        const db = SurrealDatabase.forExternal({
            namespace: `open_mission_code_graph_schema_${randomUUID().replace(/-/g, '_')}`
        });

        try {
            await db.query(compileCodeGraphSurql());

            const [snapshotInfo] = await db.query('INFO FOR TABLE code_index_snapshot;');
            const [objectInfo] = await db.query('INFO FOR TABLE code_object;');
            const [relationInfo] = await db.query('INFO FOR TABLE code_relation;');

            expect(Object.keys(tableInfo(snapshotInfo).fields ?? {})).toEqual(expect.arrayContaining([
                'codeRootId',
                'rootFingerprint',
                'status'
            ]));
            expect(Object.keys(tableInfo(objectInfo).indexes ?? {})).toEqual(expect.arrayContaining([
                'code_object_snapshot_kind_path_idx',
                'code_object_snapshot_kind_name_idx'
            ]));
            expect(Object.keys(tableInfo(relationInfo).fields ?? {})).toEqual(expect.arrayContaining([
                'snapshotId',
                'relationKind',
                'in',
                'out'
            ]));
        } finally {
            await db.stop();
        }
    });
});