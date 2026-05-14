import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentExecution } from '../../entities/AgentExecution/AgentExecution.js';
import { createSurrealEntityFactory } from '../factory.js';
import {
    resolveMissionOwnedDatabasePath,
    resolveOwnerDatabasePath,
    resolveRepositoryDatabasePath,
    resolveSystemDatabasePath,
    SurrealDatabase
} from './SurrealDatabase.js';

describe('SurrealEntityStore', () => {
    it('persists EntityFactory records in repository .open-mission/database SurrealKV storage', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-surreal-entity-'));
        const database = SurrealDatabase.forOwner({
            ownerEntity: 'Repository',
            repositoryRootPath: rootPath,
            namespace: 'open_mission_entity_store_test',
            database: 'mission'
        });
        const factory = createSurrealEntityFactory({ database });
        const data = AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'repository-1',
            agentId: 'agent-1',
            agentExecutionId: 'execution-1'
        });

        try {
            const created = await factory.create(AgentExecution, data);
            const read = await factory.read(AgentExecution, created.id);
            const records = await factory.find(AgentExecution);

            expect(database.readStatus()).toMatchObject({
                available: true,
                engine: 'surrealkv',
                namespace: 'open_mission_entity_store_test',
                database: 'mission',
                storagePath: resolveRepositoryDatabasePath(rootPath)
            });
            await expect(fs.stat(resolveRepositoryDatabasePath(rootPath))).resolves.toBeDefined();
            expect(read?.toData()).toEqual(data);
            expect(records.map((record) => record.id)).toContain(data.id);

            await factory.remove(AgentExecution, data.id);
            await expect(factory.read(AgentExecution, data.id)).resolves.toBeUndefined();
        } finally {
            await database.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('resolves database paths from owner context', () => {
        expect(resolveSystemDatabasePath('/config/open-mission')).toBe(path.join('/config/open-mission', 'database'));
        expect(resolveOwnerDatabasePath({
            ownerEntity: 'Repository',
            repositoryRootPath: '/repo'
        })).toBe(resolveRepositoryDatabasePath('/repo'));
        expect(resolveOwnerDatabasePath({
            ownerEntity: 'Mission',
            missionRootPath: '/repo',
            missionId: 'mission-1'
        })).toBe(resolveMissionOwnedDatabasePath('/repo', 'mission-1'));
        expect(resolveMissionOwnedDatabasePath('/repo', 'mission-1'))
            .toBe(path.join('/repo', '.open-mission', 'missions', 'mission-1', 'database'));
    });

    it('reuses shared database drivers per owner location', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-surreal-shared-'));
        const repositoryDatabase = SurrealDatabase.sharedForOwner({
            ownerEntity: 'Repository',
            repositoryRootPath: rootPath,
            namespace: 'open_mission_shared_connection_test'
        });
        const sameRepositoryDatabase = SurrealDatabase.sharedForOwner({
            ownerEntity: 'Repository',
            repositoryRootPath: rootPath,
            namespace: 'open_mission_shared_connection_test'
        });
        const missionDatabase = SurrealDatabase.sharedForOwner({
            ownerEntity: 'Mission',
            missionRootPath: rootPath,
            missionId: 'mission-1',
            namespace: 'open_mission_shared_connection_test'
        });

        try {
            expect(sameRepositoryDatabase).toBe(repositoryDatabase);
            expect(missionDatabase).not.toBe(repositoryDatabase);

            await repositoryDatabase.start();
            await sameRepositoryDatabase.start();
            expect(sameRepositoryDatabase.readStatus()).toMatchObject({
                available: true,
                storagePath: resolveRepositoryDatabasePath(rootPath)
            });
        } finally {
            await repositoryDatabase.stop();
            await missionDatabase.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});