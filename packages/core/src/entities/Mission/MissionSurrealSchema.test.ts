import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileDefineStatements, compileSchema, defineModel } from '@flying-pillow/zod-surreal';
import { Surreal } from 'surrealdb';
import { SurrealDatabase } from '../../lib/database/SurrealDatabase.js';
import { MissionStorageSchema } from './MissionSchema.js';
import { StageStorageSchema } from '../Stage/StageSchema.js';
import { TaskStorageSchema } from '../Task/TaskSchema.js';

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

async function infoForTable(db: Surreal, tableName: string): Promise<TableInfo> {
    const [info] = await db.query(`INFO FOR TABLE ${tableName};`);
    return tableInfo(info);
}

describe('Mission Surreal schema compilation', () => {
    it('compiles Mission, Stage, and Task physical storage schemas into DDL accepted by external SurrealDB', async () => {
        const snapshot = compileSchema({
            models: [
                defineModel({ name: 'Mission', schema: MissionStorageSchema }),
                defineModel({ name: 'Stage', schema: StageStorageSchema }),
                defineModel({ name: 'Task', schema: TaskStorageSchema })
            ]
        });
        const statements = compileDefineStatements(snapshot);

        const database = SurrealDatabase.forExternal({
            namespace: `mission_core_schema_test_${randomUUID().replace(/-/g, '_')}`
        });
        const db = await database.getClient();

        try {
            await db.query(statements.join('\n'));

            const missionInfo = await infoForTable(db, 'mission');
            const stageInfo = await infoForTable(db, 'stage');
            const taskInfo = await infoForTable(db, 'task');

            expect(Object.keys(missionInfo.fields ?? {})).toEqual(expect.arrayContaining([
                'title',
                'branchRef',
                'currentStageId'
            ]));
            expect(Object.keys(stageInfo.fields ?? {})).toEqual(expect.arrayContaining([
                'missionId',
                'lifecycle',
                'isCurrentStage',
                'artifacts'
            ]));
            expect(Object.keys(taskInfo.fields ?? {})).toEqual(expect.arrayContaining([
                'missionId',
                'stageId',
                'sequence',
                'title',
                'instruction',
                'lifecycle'
            ]));

            expect(Object.keys(missionInfo.indexes ?? {})).toEqual(expect.arrayContaining([
                'mission_title_ft_idx',
                'mission_branchref_idx'
            ]));
            expect(Object.keys(stageInfo.indexes ?? {})).toEqual(expect.arrayContaining([
                'stage_missionid_idx',
                'stage_lifecycle_idx'
            ]));
            expect(Object.keys(taskInfo.indexes ?? {})).toEqual(expect.arrayContaining([
                'task_missionid_idx',
                'task_stageid_idx',
                'task_title_ft_idx',
                'task_instruction_ft_idx'
            ]));

            expect(stageInfo.fields?.['missionId']).toContain('record<mission>');
            expect(taskInfo.fields?.['missionId']).toContain('record<mission>');
            expect(taskInfo.fields?.['stageId']).toContain('record<stage>');
        } finally {
            await database.stop();
        }
    });
});