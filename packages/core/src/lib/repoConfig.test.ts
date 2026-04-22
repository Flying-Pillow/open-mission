import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMissionWorktreesPath, resolveMissionWorkspaceRoot } from './repoConfig.js';

describe('repoConfig', () => {
	beforeEach(() => {
		delete process.env['MISSIONS_PATH'];
	});

	afterEach(() => {
		delete process.env['MISSIONS_PATH'];
	});

	it('prefers MISSIONS_PATH for the default workspace root', () => {
		process.env['MISSIONS_PATH'] = '/missions';

		expect(resolveMissionWorkspaceRoot()).toBe('/missions');
		expect(resolveMissionWorkspaceRoot('missions')).toBe('/missions');
	});

	it('keeps explicit absolute mission workspace roots ahead of MISSIONS_PATH', () => {
		process.env['MISSIONS_PATH'] = '/missions';

		expect(resolveMissionWorkspaceRoot('/srv/custom-missions')).toBe('/srv/custom-missions');
	});

	it('keeps existing home-relative fallback when MISSIONS_PATH is absent', () => {
		delete process.env['MISSIONS_PATH'];

		expect(resolveMissionWorkspaceRoot()).toBe(path.resolve(os.homedir(), 'missions'));
	});

	it('nests mission worktrees under the full GitHub repository path for GitHub checkouts', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-config-github-'));
		try {
			spawnSync('git', ['init'], { cwd: workspaceRoot, stdio: 'pipe' });
			spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:Flying-Pillow/connect-four.git'], {
				cwd: workspaceRoot,
				stdio: 'pipe'
			});

			expect(getMissionWorktreesPath(workspaceRoot, { missionWorkspaceRoot: '/missions' })).toBe(
				path.join('/missions', 'Flying-Pillow', 'connect-four')
			);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});