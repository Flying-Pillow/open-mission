import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodeIndexer } from './CodeIndexer.js';

describe('CodeIndexer', () => {
    it('indexes source files, exported symbols, and import relations while excluding generated runtime paths', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-code-indexer-'));
        await fs.mkdir(path.join(rootPath, 'src'), { recursive: true });
        await fs.mkdir(path.join(rootPath, 'node_modules', 'ignored'), { recursive: true });
        await fs.mkdir(path.join(rootPath, '.open-mission', 'runtime'), { recursive: true });
        await fs.mkdir(path.join(rootPath, 'dist'), { recursive: true });
        await fs.writeFile(path.join(rootPath, '.gitignore'), [
            'node_modules/',
            'dist/'
        ].join('\n'));
        await fs.writeFile(path.join(rootPath, 'src', 'index.ts'), [
            "import { helper } from './helper.js';",
            "export class AppService {}",
            'export function runApp() { return helper(); }'
        ].join('\n'));
        await fs.writeFile(path.join(rootPath, 'src', 'helper.ts'), [
            'export const helper = () => 1;',
            'export interface HelperOptions { enabled: boolean }'
        ].join('\n'));
        await fs.writeFile(path.join(rootPath, 'src', 'tool.py'), 'def run_tool():\n    return 1\n');
        await fs.writeFile(path.join(rootPath, 'README.md'), '# Example\n');
        await fs.writeFile(path.join(rootPath, 'asset.bin'), Buffer.from([0, 159, 146, 150]));
        await fs.writeFile(path.join(rootPath, 'node_modules', 'ignored', 'module.ts'), 'export const ignored = true;');
        await fs.writeFile(path.join(rootPath, '.open-mission', 'runtime', 'generated.ts'), 'export const generated = true;');
        await fs.writeFile(path.join(rootPath, 'dist', 'bundle.js'), 'export const bundled = true;');

        try {
            const result = await new CodeIndexer().indexCodeRoot({ rootPath });

            expect(result.rootPath).toBe(rootPath);
            expect(result.objects.filter((object) => object.objectKind === 'file' || object.objectKind === 'document').map((object) => object.path)).toEqual([
                '.gitignore',
                'README.md',
                'src/helper.ts',
                'src/index.ts',
                'src/tool.py'
            ]);
            expect(result.objects.filter((object) => object.objectKind === 'file' || object.objectKind === 'document').map((object) => `${object.objectKind}:${object.language}:${object.path}`)).toEqual([
                'document:unknown:.gitignore',
                'document:markdown:README.md',
                'file:typescript:src/helper.ts',
                'file:typescript:src/index.ts',
                'file:python:src/tool.py'
            ]);
            expect(result.objects.filter((object) => object.objectKind === 'symbol').map((object) => `${object.symbolKind}:${object.name}:${object.path}`)).toEqual([
                'const:helper:src/helper.ts',
                'interface:HelperOptions:src/helper.ts',
                'class:AppService:src/index.ts',
                'function:runApp:src/index.ts'
            ]);
            expect(result.relations).toEqual([
                {
                    inObjectKey: 'root',
                    relationKind: 'contains',
                    outObjectKey: 'path:.gitignore'
                },
                {
                    inObjectKey: 'root',
                    relationKind: 'contains',
                    outObjectKey: 'path:README.md'
                },
                {
                    inObjectKey: 'root',
                    relationKind: 'contains',
                    outObjectKey: 'path:src/helper.ts'
                },
                {
                    inObjectKey: 'root',
                    relationKind: 'contains',
                    outObjectKey: 'path:src/index.ts'
                },
                {
                    inObjectKey: 'root',
                    relationKind: 'contains',
                    outObjectKey: 'path:src/tool.py'
                },
                {
                    inObjectKey: 'path:src/helper.ts',
                    relationKind: 'defines',
                    outObjectKey: 'symbol:src/helper.ts:const:helper:1'
                },
                {
                    inObjectKey: 'path:src/helper.ts',
                    relationKind: 'defines',
                    outObjectKey: 'symbol:src/helper.ts:interface:HelperOptions:2'
                },
                {
                    inObjectKey: 'path:src/index.ts',
                    relationKind: 'imports',
                    outObjectKey: 'path:src/helper.ts'
                },
                {
                    inObjectKey: 'path:src/index.ts',
                    relationKind: 'defines',
                    outObjectKey: 'symbol:src/index.ts:class:AppService:2'
                },
                {
                    inObjectKey: 'path:src/index.ts',
                    relationKind: 'defines',
                    outObjectKey: 'symbol:src/index.ts:function:runApp:3'
                }
            ]);
            expect(result.rootFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});