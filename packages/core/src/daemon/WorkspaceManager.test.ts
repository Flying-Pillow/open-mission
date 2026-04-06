import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { WorkspaceManager } from './WorkspaceManager.js';

describe('WorkspaceManager surface resolution', () => {
    it('binds a surface to the git repository root instead of scanning descendants', async () => {
        const workspaceRoot = await createTempRepo();
        const nestedSurfacePath = path.join(workspaceRoot, 'src', 'features');
        const descendantMissionRoot = path.join(workspaceRoot, 'subproject-with-missions');

        try {
            await fs.mkdir(nestedSurfacePath, { recursive: true });
            await fs.mkdir(path.join(descendantMissionRoot, '.missions'), { recursive: true });

            const discovery = await createWorkspaceManagerTestHarness().discoverSurface(nestedSurfacePath);

            expect(discovery).toEqual({
                surfacePath: nestedSurfacePath,
                primaryControlRoot: workspaceRoot,
                controlRoots: [workspaceRoot]
            });
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('maps a mission worktree surface back to its control repository root', async () => {
        const workspaceRoot = await createTempRepo();
        const missionRoot = path.join(workspaceRoot, '.missions', 'active', 'architecture-refactor');
        const missionWorkspacePath = path.join(missionRoot, 'workspace');
        const nestedMissionPath = path.join(missionWorkspacePath, 'packages', 'core');

        try {
            await fs.mkdir(missionRoot, { recursive: true });
            runGit(workspaceRoot, ['worktree', 'add', missionWorkspacePath, '-b', 'mission/architecture-refactor']);
            await fs.mkdir(nestedMissionPath, { recursive: true });

            const discovery = await createWorkspaceManagerTestHarness().discoverSurface(nestedMissionPath);

            expect(discovery).toEqual({
                surfacePath: nestedMissionPath,
                primaryControlRoot: workspaceRoot,
                controlRoots: [workspaceRoot]
            });
        } finally {
            runGit(workspaceRoot, ['worktree', 'remove', '--force', missionWorkspacePath]);
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });
});

async function createTempRepo(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-surface-discovery-'));
    runGit(workspaceRoot, ['init']);
    runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
    runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
    runGit(workspaceRoot, ['add', 'README.md']);
    runGit(workspaceRoot, ['commit', '-m', 'init']);
    return workspaceRoot;
}

function runGit(workspaceRoot: string, args: string[]): void {
    const result = spawnSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
    }
}

function createWorkspaceManagerTestHarness(): {
    discoverSurface: (surfacePath: string) => Promise<{
        surfacePath: string;
        primaryControlRoot: string;
        controlRoots: string[];
    }>;
} {
    return new WorkspaceManager(new Map(), () => undefined) as unknown as {
        discoverSurface: (surfacePath: string) => Promise<{
            surfacePath: string;
            primaryControlRoot: string;
            controlRoots: string[];
        }>;
    };
}