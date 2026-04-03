import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getRepoRoot, resolveGitControlRepoRoot, resolveMissionWorkspaceContext } from './repoPaths.js';

describe('repoPaths', () => {
	it('resolves the control repository root from within a git worktree', async () => {
		const repoRoot = await createTempRepo();
		const worktreePath = path.join(repoRoot, '.mission-worktree-test');

		try {
			runGit(repoRoot, ['worktree', 'add', worktreePath, '-b', 'mission/test-worktree']);

			expect(resolveGitControlRepoRoot(worktreePath)).toBe(repoRoot);
			expect(getRepoRoot(worktreePath)).toBe(repoRoot);
			expect(resolveMissionWorkspaceContext(worktreePath)).toMatchObject({
				kind: 'control-root',
				repoRoot,
				selector: {}
			});
		} finally {
			runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('detects mission worktrees under .mission/worktrees and derives mission selectors automatically', async () => {
		const repoRoot = await createTempRepo();
		const missionId = 'mission-123-auto-select';
		const missionWorktreePath = path.join(repoRoot, '.mission', 'worktrees', missionId);
		const nestedPath = path.join(missionWorktreePath, 'src');

		try {
			await fs.mkdir(path.dirname(missionWorktreePath), { recursive: true });
			runGit(repoRoot, ['worktree', 'add', missionWorktreePath, '-b', 'mission/test-auto-select']);
			await fs.mkdir(nestedPath, { recursive: true });

			expect(resolveMissionWorkspaceContext(missionWorktreePath, repoRoot)).toMatchObject({
				kind: 'mission-worktree',
				repoRoot,
				missionId,
				missionDir: missionWorktreePath,
				selector: { missionId }
			});
			expect(resolveMissionWorkspaceContext(nestedPath, repoRoot)).toMatchObject({
				kind: 'mission-worktree',
				repoRoot,
				missionId,
				missionDir: missionWorktreePath,
				selector: { missionId }
			});
		} finally {
			runGit(repoRoot, ['worktree', 'remove', '--force', missionWorktreePath]);
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});

async function createTempRepo(): Promise<string> {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-repopaths-'));
	runGit(repoRoot, ['init']);
	runGit(repoRoot, ['config', 'user.email', 'mission@example.com']);
	runGit(repoRoot, ['config', 'user.name', 'Mission Test']);
	await fs.writeFile(path.join(repoRoot, 'README.md'), '# Mission Test\n', 'utf8');
	runGit(repoRoot, ['add', 'README.md']);
	runGit(repoRoot, ['commit', '-m', 'init']);
	return repoRoot;
}

function runGit(repoRoot: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
}