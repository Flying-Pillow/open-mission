import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImpeccableLiveRegistry } from './ImpeccableLiveRegistry.js';

describe('ImpeccableLiveRegistry', () => {
    it('starts and owns a live server for a repository owner', async () => {
        const surfacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-impeccable-live-registry-'));
        const registry = new ImpeccableLiveRegistry({
            daemonProcessId: process.pid,
            startedAt: '2026-05-16T00:00:00.000Z',
            resolveSurfacePath: async () => surfacePath,
        });

        try {
            const session = await registry.ensureSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            });

            expect(session.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
            const snapshot = registry.readRuntimeSnapshot();
            expect(snapshot.leases).toHaveLength(1);
            expect(snapshot.leases[0]).toEqual(expect.objectContaining({
                kind: 'process',
                state: 'active',
                metadata: expect.objectContaining({
                    origin: session.origin,
                    surfacePath,
                    launchMode: 'daemon-started'
                })
            }));
        } finally {
            await registry.dispose();
            await fs.rm(surfacePath, { recursive: true, force: true });
        }
    });

    it('stops a daemon-owned live server for a repository owner', async () => {
        const surfacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-impeccable-live-registry-stop-'));
        const registry = new ImpeccableLiveRegistry({
            daemonProcessId: process.pid,
            startedAt: '2026-05-16T00:00:00.000Z',
            resolveSurfacePath: async () => surfacePath,
        });

        try {
            await registry.ensureSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            });

            await expect(registry.stopSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            })).resolves.toEqual({ stopped: true });
            expect(registry.readRuntimeSnapshot().leases).toHaveLength(0);
            await expect(registry.stopSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            })).resolves.toEqual({ stopped: false });
        } finally {
            await registry.dispose();
            await fs.rm(surfacePath, { recursive: true, force: true });
        }
    });
});