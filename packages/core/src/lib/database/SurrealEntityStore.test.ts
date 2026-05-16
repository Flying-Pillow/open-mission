import { describe, expect, it } from 'vitest';
import { AgentExecution } from '../../entities/AgentExecution/AgentExecution.js';
import { createSurrealEntityFactory } from '../factory.js';
import { SurrealDatabase } from './SurrealDatabase.js';
import {
    clearSurrealTables,
    createTestSurrealDatabase,
    TEST_SURREAL_DATABASE,
    TEST_SURREAL_NAMESPACE
} from './SurrealTestDatabase.js';

describe('SurrealEntityStore', () => {
    it('persists EntityFactory records in the external SurrealDB database', async () => {
        const database = createTestSurrealDatabase();
        const factory = createSurrealEntityFactory({ database });
        const first = AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'repository-1',
            agentId: 'agent-1',
            agentExecutionId: 'execution-1'
        });
        const second = AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'repository-2',
            agentId: 'agent-2',
            agentExecutionId: 'execution-2'
        });

        try {
            await clearSurrealTables(database, ['agent_execution_journal', 'agent_execution']);
            const created = await factory.create(AgentExecution, first);
            await factory.create(AgentExecution, second);
            const read = await factory.read(AgentExecution, created.id);
            const records = await factory.find(AgentExecution, {
                where: {
                    field: 'ownerId',
                    operator: '=',
                    value: 'repository-1'
                },
                start: 0,
                limit: 1,
                pagination: true
            });

            expect(database.readStatus()).toMatchObject({
                available: true,
                engine: 'remote',
                namespace: TEST_SURREAL_NAMESPACE,
                database: TEST_SURREAL_DATABASE
            });
            expect(read?.toData()).toEqual(first);
            expect(records.count).toBe(1);
            expect(records.start).toBe(0);
            expect(records.total).toBe(1);
            expect(records.entities.map((record) => record.id)).toEqual([first.id]);

            await factory.remove(AgentExecution, first.id);
            await factory.remove(AgentExecution, second.id);
            await expect(factory.read(AgentExecution, first.id)).resolves.toBeUndefined();
        } finally {
            await clearSurrealTables(database, ['agent_execution_journal', 'agent_execution']);
            await database.stop();
        }
    });

    it('reuses shared database drivers per external database scope', async () => {
        const sharedDatabase = createTestSurrealDatabase({ shared: true });
        const sameSharedDatabase = createTestSurrealDatabase({ shared: true });
        const differentDatabase = SurrealDatabase.sharedForExternal({
            namespace: TEST_SURREAL_NAMESPACE,
            database: 'other'
        });

        try {
            expect(sameSharedDatabase).toBe(sharedDatabase);
            expect(differentDatabase).not.toBe(sharedDatabase);

            await sharedDatabase.start();
            await sameSharedDatabase.start();
            expect(sameSharedDatabase.readStatus()).toMatchObject({
                available: true,
                engine: 'remote',
                namespace: TEST_SURREAL_NAMESPACE,
                database: TEST_SURREAL_DATABASE
            });
        } finally {
            await sharedDatabase.stop();
            await differentDatabase.stop();
        }
    });
});