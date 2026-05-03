import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { MissionDescriptor } from '../../types.js';
import { RepositoryPreparationOperation } from './RepositoryPreparationOperation.js';

describe('RepositoryPreparationOperation', () => {
    it('initializes Repository control state inside the Mission worktree root', async () => {
        const missionWorktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-preparation-operation-'));
        const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-preparation-repository-'));
        const missionDir = path.join(missionWorktreeRoot, '.mission', 'missions', '3-prepare-repo-for-mission');
        const operation = new RepositoryPreparationOperation(new FilesystemAdapter(missionWorktreeRoot));

        try {
            await fs.mkdir(missionDir, { recursive: true });

            await expect(operation.execute({ descriptor: createDescriptor(missionDir) })).resolves.toMatchObject({
                settingsDocumentPath: path.join(missionWorktreeRoot, '.mission', 'settings.json'),
                workflowDefinitionPath: path.join(missionWorktreeRoot, '.mission', 'workflow', 'workflow.json')
            });

            await expect(fs.stat(path.join(missionWorktreeRoot, '.mission', 'settings.json'))).resolves.toBeDefined();
            await expect(fs.stat(path.join(missionWorktreeRoot, '.mission', 'workflow', 'workflow.json'))).resolves.toBeDefined();
            await expect(fs.stat(path.join(repositoryRoot, '.mission', 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await fs.rm(missionWorktreeRoot, { recursive: true, force: true });
            await fs.rm(repositoryRoot, { recursive: true, force: true });
        }
    });
});

function createDescriptor(missionDir: string): MissionDescriptor {
    return {
        missionId: path.basename(missionDir),
        missionDir,
        branchRef: 'mission/3-prepare-repo-for-mission',
        createdAt: '2026-05-02T17:00:00.000Z',
        brief: {
            title: 'Prepare repo for Mission',
            body: 'Prepare Repository control state in the Mission worktree.',
            type: 'task',
            issueId: 3
        }
    };
}
