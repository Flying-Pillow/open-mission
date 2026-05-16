import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DaemonSurrealStore } from '../DaemonSurrealStore.js';
import { SurrealDatabase } from '../../../lib/database/SurrealDatabase.js';
import { CodeIndexer } from './CodeIndexer.js';
import { CodeGraphStore } from './CodeGraphStore.js';

describe('CodeGraphStore', () => {
    it('replaces and reads an active Code intelligence index snapshot from external SurrealDB', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-code-graph-store-'));
        await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
        await fs.writeFile(path.join(rootPath, 'src', 'index.ts'), [
            "import { makeGreeting } from './message.js';",
            'export function greet() { return makeGreeting(); }'
        ].join('\n'));
        await fs.writeFile(path.join(rootPath, 'src', 'message.ts'), 'export const makeGreeting = () => "hello";');

        const surrealStore = new DaemonSurrealStore({
            databaseDriver: SurrealDatabase.forExternal({
                namespace: `open_mission_code_graph_store_${randomUUID().replace(/-/g, '_')}`
            })
        });
        await surrealStore.start();

        try {
            const indexInput = await new CodeIndexer().indexCodeRoot({ rootPath });
            const graphStore = new CodeGraphStore({ surrealStore });
            const firstIndex = await graphStore.replaceIndex({
                ...indexInput,
                indexedAt: '2026-05-12T00:00:00.000Z'
            });

            expect(firstIndex.snapshot).toMatchObject({
                status: 'active',
                objectCount: 5,
                relationCount: 5
            });
            expect(await graphStore.readActiveSnapshot(rootPath)).toMatchObject({
                id: firstIndex.snapshot.id,
                status: 'active'
            });
            await expect(graphStore.searchObjectsByName({ snapshotId: firstIndex.snapshot.id, objectKind: 'symbol', name: 'greet' })).resolves.toHaveLength(1);
            await expect(graphStore.searchObjectsByPath({ snapshotId: firstIndex.snapshot.id, objectKind: 'file', pathIncludes: 'message' })).resolves.toHaveLength(1);

            await fs.writeFile(path.join(rootPath, 'src', 'extra.ts'), 'export class ExtraService {}');
            const secondInput = await new CodeIndexer().indexCodeRoot({ rootPath });
            const secondIndex = await graphStore.replaceIndex({
                ...secondInput,
                indexedAt: '2026-05-12T00:01:00.000Z'
            });

            expect(secondIndex.snapshot).toMatchObject({
                status: 'active',
                previousActiveSnapshotId: firstIndex.snapshot.id,
                objectCount: 7
            });
            await expect(graphStore.readIndex(firstIndex.snapshot.id)).resolves.toMatchObject({
                snapshot: { status: 'replaced' }
            });
            await expect(graphStore.listObjectsByKind({ snapshotId: secondIndex.snapshot.id, objectKind: 'symbol' })).resolves.toHaveLength(3);
        } finally {
            await surrealStore.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});