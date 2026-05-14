import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRepositoryDatabasePath } from '../../../lib/database/SurrealDatabase.js';
import { CodeIntelligenceService } from './CodeIntelligenceService.js';

describe('CodeIntelligenceService', () => {
    it('indexes a prepared Code root into a repository-local active snapshot', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-code-intelligence-service-'));
        await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
        await fs.writeFile(path.join(rootPath, '.gitignore'), 'dist/\n');
        await fs.writeFile(path.join(rootPath, 'README.md'), '# Indexed Repository\n');
        await fs.writeFile(path.join(rootPath, 'src', 'index.ts'), 'export class IndexedRepository {}\n');
        await fs.mkdir(path.join(rootPath, 'dist'), { recursive: true });
        await fs.writeFile(path.join(rootPath, 'dist', 'ignored.ts'), 'export class Ignored {}\n');
        const service = new CodeIntelligenceService();

        try {
            const index = await service.ensureIndex({ rootPath });

            expect(index.snapshot).toMatchObject({
                rootPath,
                status: 'active',
                fileCount: 3,
                symbolCount: 1
            });
            expect(index.files.map((file) => file.path)).toEqual([
                '.gitignore',
                'README.md',
                'src/index.ts'
            ]);
            expect(index.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual([
                'class:IndexedRepository'
            ]);
            await expect(fs.stat(resolveRepositoryDatabasePath(rootPath))).resolves.toBeDefined();
        } finally {
            await service.stop();
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});