import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DaemonSurrealStore, resolveDaemonSurrealStorePath } from './DaemonSurrealStore.js';

describe('DaemonSurrealStore', () => {
    it('opens an embedded SurrealDB database under the root .mission runtime folder', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-surreal-root-'));
        const store = DaemonSurrealStore.forCodeRoot({
            rootPath,
            namespace: 'mission_daemon_test'
        });
        const storagePath = resolveDaemonSurrealStorePath(rootPath);

        await store.start();
        try {
            expect(store.readStatus()).toMatchObject({
                available: true,
                engine: 'surrealkv',
                namespace: 'mission_daemon_test',
                database: 'code_intelligence',
                storagePath
            });
            await expect(fs.stat(storagePath)).resolves.toBeDefined();

            await expect(store.query('RETURN $value;', { value: 'ready' })).resolves.toEqual(['ready']);
        } finally {
            await store.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('keeps in-memory storage available only by explicit construction', async () => {
        const store = DaemonSurrealStore.inMemory({
            namespace: 'mission_daemon_memory_test',
            database: 'mission'
        });

        await store.start();
        await store.stop();

        expect(store.readStatus()).toMatchObject({
            available: false,
            engine: 'mem',
            namespace: 'mission_daemon_memory_test',
            database: 'mission'
        });
    });
});