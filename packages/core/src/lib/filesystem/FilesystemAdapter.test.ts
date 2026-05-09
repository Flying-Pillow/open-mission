import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemAdapter } from './FilesystemAdapter.js';

describe('FilesystemAdapter', () => {
    it('ensures and appends text files under missing directories', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
        try {
            const adapter = new FilesystemAdapter();
            const filePath = path.join(rootPath, 'nested', 'events.jsonl');

            await adapter.ensureTextFile(filePath);
            await adapter.appendTextFile(filePath, 'first\n');
            await adapter.appendTextFile(filePath, 'second\n');

            await expect(adapter.readTextFile(filePath)).resolves.toBe('first\nsecond\n');
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});