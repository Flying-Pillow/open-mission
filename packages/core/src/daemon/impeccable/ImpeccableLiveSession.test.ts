import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveImpeccableLiveSession, resolveImpeccableLiveSurfacePath } from './ImpeccableLiveSession.js';

describe('resolveImpeccableLiveSession', () => {
    it('prefers the persisted origin when the live server records one', async () => {
        const surfacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-impeccable-live-'));

        try {
            await fs.mkdir(path.join(surfacePath, '.impeccable', 'live'), { recursive: true });
            await fs.writeFile(
                path.join(surfacePath, '.impeccable', 'live', 'server.json'),
                JSON.stringify({
                    pid: 42,
                    port: 8400,
                    token: 'token',
                    origin: 'http://sandbox-bridge.internal:18400'
                })
            );

            await expect(resolveImpeccableLiveSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            }, {
                resolveRepositoryRootPath: async () => surfacePath,
                resolveMissionSurfacePath: async () => '/unreachable'
            })).resolves.toEqual({
                origin: 'http://sandbox-bridge.internal:18400'
            });
        } finally {
            await fs.rm(surfacePath, { recursive: true, force: true });
        }
    });

    it('rejects persisted live server records that omit origin', async () => {
        const surfacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-impeccable-live-legacy-'));

        try {
            await fs.mkdir(path.join(surfacePath, '.impeccable', 'live'), { recursive: true });
            await fs.writeFile(
                path.join(surfacePath, '.impeccable', 'live', 'server.json'),
                JSON.stringify({
                    pid: 42,
                    port: 8400,
                    token: 'token'
                })
            );

            await expect(resolveImpeccableLiveSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            }, {
                resolveRepositoryRootPath: async () => surfacePath,
                resolveMissionSurfacePath: async () => '/unreachable'
            })).rejects.toThrow(`No running Impeccable live server found for '${surfacePath}'.`);
        } finally {
            await fs.rm(surfacePath, { recursive: true, force: true });
        }
    });

    it('resolves repository-owned live roots from repository ids before reading the live server record', async () => {
        const surfacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-impeccable-live-repository-'));

        try {
            await fs.mkdir(path.join(surfacePath, '.impeccable', 'live'), { recursive: true });
            await fs.writeFile(
                path.join(surfacePath, '.impeccable', 'live', 'server.json'),
                JSON.stringify({ pid: 42, port: 8400, token: 'token', origin: 'http://127.0.0.1:8400' })
            );

            await expect(resolveImpeccableLiveSession({
                params: { repositoryId: 'repository:github/Flying-Pillow/open-mission' }
            }, {
                resolveRepositoryRootPath: async () => surfacePath,
                resolveMissionSurfacePath: async () => '/unreachable'
            })).resolves.toEqual({ origin: 'http://127.0.0.1:8400' });
        } finally {
            await fs.rm(surfacePath, { recursive: true, force: true });
        }
    });

    it('resolves mission-owned live roots from mission ids', async () => {
        await expect(resolveImpeccableLiveSurfacePath({
            params: { missionId: 'mission-7' }
        }, {
            resolveRepositoryRootPath: async () => '/unreachable',
            resolveMissionSurfacePath: async () => '/worktrees/mission-7'
        })).resolves.toBe('/worktrees/mission-7');
    });

    it('rejects missing owner selectors', async () => {
        await expect(resolveImpeccableLiveSurfacePath({
            params: {}
        }, {
            resolveRepositoryRootPath: async () => '/unreachable',
            resolveMissionSurfacePath: async () => '/unreachable'
        })).rejects.toThrow('Provide exactly one of repositoryId or missionId.');
    });
});