import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DaemonSurrealStore, resolveDaemonSurrealStorePath } from './DaemonSurrealStore.js';

describe('DaemonSurrealStore', () => {
    it('opens the repository-owned embedded SurrealDB database', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-surreal-root-'));
        const store = DaemonSurrealStore.forCodeRoot({
            rootPath
        });
        const storagePath = resolveDaemonSurrealStorePath(rootPath);

        await store.start();
        try {
            expect(store.readStatus()).toMatchObject({
                available: true,
                engine: 'surrealkv',
                namespace: 'open_mission',
                database: 'mission',
                storagePath
            });
            await expect(fs.stat(storagePath)).resolves.toBeDefined();

            await expect(store.query('RETURN $value;', { value: 'ready' })).resolves.toEqual(['ready']);
        } finally {
            await store.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('keeps in-memory storage available only through the shared driver', async () => {
        const store = DaemonSurrealStore.inMemory();

        await store.start();
        await store.stop();

        expect(store.readStatus()).toMatchObject({
            available: false,
            engine: 'mem',
            namespace: 'open_mission',
            database: 'mission'
        });
    });
});