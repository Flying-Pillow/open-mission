import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from './WorkspaceManager.js';
import { readMissionUserConfig } from '../lib/userConfig.js';

describe('WorkspaceManager surface resolution', () => {
	beforeEach(async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-workspace-manager-config-'));
	});

    afterEach(async () => {
        const configHome = process.env['XDG_CONFIG_HOME'];
        if (configHome) {
            await fs.rm(configHome, { recursive: true, force: true });
            delete process.env['XDG_CONFIG_HOME'];
        }
    });

    it('binds a surface to the git repository root instead of scanning descendants', async () => {
        const workspaceRoot = await createTempRepo();
        const nestedSurfacePath = path.join(workspaceRoot, 'src', 'features');
        const descendantMissionRoot = path.join(workspaceRoot, 'subproject-with-missions');

        try {
            await fs.mkdir(nestedSurfacePath, { recursive: true });
            await fs.mkdir(path.join(descendantMissionRoot, '.mission'), { recursive: true });

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
        const missionWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-workspace-manager-'));
        const missionWorkspacePath = path.join(missionWorkspaceRoot, 'architecture-refactor');
        const missionRoot = path.join(missionWorkspacePath, '.mission', 'missions', 'architecture-refactor');
        const nestedMissionPath = path.join(missionWorkspacePath, 'packages', 'core');

        try {
            runGit(workspaceRoot, ['worktree', 'add', missionWorkspacePath, '-b', 'mission/architecture-refactor']);
            await fs.mkdir(missionRoot, { recursive: true });
            await fs.mkdir(nestedMissionPath, { recursive: true });

            const discovery = await createWorkspaceManagerTestHarness().discoverSurface(nestedMissionPath);

            expect(discovery).toEqual({
                surfacePath: nestedMissionPath,
                primaryControlRoot: workspaceRoot,
                controlRoots: [workspaceRoot]
            });
        } finally {
            runGit(workspaceRoot, ['worktree', 'remove', '--force', missionWorkspacePath]);
            await fs.rm(missionWorkspaceRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('does not auto-register repositories during surface discovery', async () => {
        const workspaceRoot = await createTempRepo();
        const manager = createWorkspaceManagerTestHarness();

        try {
            await manager.discoverSurface(workspaceRoot);
            expect(readMissionUserConfig()).toBeUndefined();
        } finally {
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