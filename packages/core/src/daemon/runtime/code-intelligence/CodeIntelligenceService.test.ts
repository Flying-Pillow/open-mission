import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DaemonSurrealStore } from '../DaemonSurrealStore.js';
import { SurrealDatabase } from '../../../lib/database/SurrealDatabase.js';
import { CodeIntelligenceService } from './CodeIntelligenceService.js';

describe('CodeIntelligenceService', () => {
    it('indexes a prepared Code root into an external SurrealDB active snapshot', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-code-intelligence-service-'));
        await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
        await fs.writeFile(path.join(rootPath, '.gitignore'), 'dist/\n');
        await fs.writeFile(path.join(rootPath, 'README.md'), '# Indexed Repository\n');
        await fs.writeFile(path.join(rootPath, 'src', 'index.ts'), 'export class IndexedRepository {}\n');
        await fs.mkdir(path.join(rootPath, 'dist'), { recursive: true });
        await fs.writeFile(path.join(rootPath, 'dist', 'ignored.ts'), 'export class Ignored {}\n');
        const surrealStore = new DaemonSurrealStore({
            databaseDriver: SurrealDatabase.forExternal({
                namespace: `open_mission_code_intelligence_${randomUUID().replace(/-/g, '_')}`
            })
        });
        await surrealStore.start();
        const service = new CodeIntelligenceService({ surrealStore });

        try {
            const index = await service.ensureIndex({ rootPath });

            expect(index.snapshot).toMatchObject({
                rootPath,
                status: 'active',
                objectCount: 5
            });
            expect(index.objects.filter((object) => object.objectKind === 'file' || object.objectKind === 'document').map((object) => object.path)).toEqual([
                '.gitignore',
                'README.md',
                'src/index.ts'
            ]);
            expect(index.objects.filter((object) => object.objectKind === 'symbol').map((object) => `${object.symbolKind}:${object.name}`)).toEqual([
                'class:IndexedRepository'
            ]);
        } finally {
            await surrealStore.stop();
            await service.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});