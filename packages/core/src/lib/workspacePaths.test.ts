import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getWorkspaceRoot, resolveGitWorkspaceRoot, resolveMissionWorkspaceContext } from './workspacePaths.js';

describe('workspacePaths', () => {
    it('resolves the control root from within a git worktree', async () => {
        const workspaceRoot = await createTempRepo();
        const worktreePath = path.join(workspaceRoot, '.mission-worktree-test');

        try {
            runGit(workspaceRoot, ['worktree', 'add', worktreePath, '-b', 'mission/test-worktree']);

            expect(resolveGitWorkspaceRoot(worktreePath)).toBe(workspaceRoot);
            expect(getWorkspaceRoot(worktreePath)).toBe(workspaceRoot);
            expect(resolveMissionWorkspaceContext(worktreePath)).toMatchObject({
                kind: 'control-root',
                workspaceRoot,
                selector: {}
            });
        } finally {
            runGit(workspaceRoot, ['worktree', 'remove', '--force', worktreePath]);
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('detects mission workspaces under .missions/active and derives mission selectors automatically', async () => {
        const workspaceRoot = await createTempRepo();
        const missionId = '123-auto-select';
        const missionRootPath = path.join(workspaceRoot, '.missions', 'active', missionId);
        const missionWorktreePath = path.join(missionRootPath, 'workspace');
        const nestedPath = path.join(missionWorktreePath, 'src');

        try {
            await fs.mkdir(path.dirname(missionWorktreePath), { recursive: true });
            runGit(workspaceRoot, ['worktree', 'add', missionWorktreePath, '-b', 'mission/test-auto-select']);
            await fs.mkdir(nestedPath, { recursive: true });

            expect(resolveMissionWorkspaceContext(missionWorktreePath, workspaceRoot)).toMatchObject({
                kind: 'mission-worktree',
                workspaceRoot,
                missionId,
                missionDir: missionWorktreePath,
                missionRootDir: missionRootPath,
                missionControlDir: path.join(missionRootPath, 'mission-control'),
                selector: { missionId }
            });
            expect(resolveMissionWorkspaceContext(nestedPath, workspaceRoot)).toMatchObject({
                kind: 'mission-worktree',
                workspaceRoot,
                missionId,
                missionDir: missionWorktreePath,
                missionRootDir: missionRootPath,
                missionControlDir: path.join(missionRootPath, 'mission-control'),
                selector: { missionId }
            });
        } finally {
            runGit(workspaceRoot, ['worktree', 'remove', '--force', missionWorktreePath]);
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });
});

async function createTempRepo(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-workspacepaths-'));
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