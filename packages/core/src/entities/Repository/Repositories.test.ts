import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repositories } from './Repositories.js';

describe('Repositories', () => {
    let configRoot: string;

    beforeEach(async () => {
        configRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-repositories-'));
        process.env['MISSION_CONFIG_PATH'] = configRoot;
    });

    afterEach(async () => {
        delete process.env['MISSION_CONFIG_PATH'];
        await fs.rm(configRoot, { recursive: true, force: true });
    });

    it('registers and lists repositories as Repository instances', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-repository-workspace-'));
        try {
            spawnSync('git', ['init'], { cwd: workspaceRoot, stdio: 'pipe' });
            spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:Flying-Pillow/mission.git'], {
                cwd: workspaceRoot,
                stdio: 'pipe'
            });

            const repository = await Repositories.register(workspaceRoot);
            const repositories = await Repositories.list();
            const found = await Repositories.find(repository.repositoryId);

            expect(repository.ownerId).toBe('Flying-Pillow');
            expect(repository.repoName).toBe('mission');
            expect(repositories).toHaveLength(1);
            expect(repositories[0]?.repositoryId).toBe(repository.repositoryId);
            expect(found?.repositoryRootPath).toBe(repository.repositoryRootPath);
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });
});