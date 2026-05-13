import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonLogger } from './DaemonLogger.js';

const temporaryRoots = new Set<string>();

afterEach(async () => {
    await Promise.all([...temporaryRoots].map(async (root) => {
        temporaryRoots.delete(root);
        await fs.rm(root, { recursive: true, force: true });
    }));
});

describe('DaemonLogger', () => {
    it('writes human-readable daemon log entries with optional metadata', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-logger-'));
        temporaryRoots.add(root);
        const logPath = path.join(root, 'daemon.log');
        const logger = new DaemonLogger(logPath);

        logger.debug('Open Mission daemon debug detail.', { source: 'test' });
        logger.info('Open Mission daemon started.', { pid: 123 });
        logger.warn('Mission hydration skipped invalid mission.', { missionId: 'mission-bad' });
        await logger.flush();

        const lines = (await fs.readFile(logPath, 'utf8')).trim().split(/\r?\n/u);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatch(/^\[.+\] DEBUG Open Mission daemon debug detail\. \{"source":"test"\}$/u);
        expect(lines[1]).toMatch(/^\[.+\] INFO Open Mission daemon started\. \{"pid":123\}$/u);
        expect(lines[2]).toMatch(/^\[.+\] WARN Mission hydration skipped invalid mission\. \{"missionId":"mission-bad"\}$/u);
    });
});
