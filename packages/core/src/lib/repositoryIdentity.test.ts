import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildGitHubRepositoryId, deriveRepositoryIdentity } from './repositoryIdentity.js';

describe('repositoryIdentity', () => {
	it('preserves exact GitHub repository casing in repository ids', () => {
		expect(buildGitHubRepositoryId('Flying-Pillow/mission')).toBe('github:Flying-Pillow:mission');
	});

	it('derives GitHub repository identities without lowercasing the remote name', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-identity-'));

		try {
			const initResult = spawnSync('git', ['init'], { cwd: workspaceRoot, stdio: 'pipe' });
			if (initResult.status !== 0) {
				throw new Error('Failed to initialize temporary git repository for repository identity test.');
			}

			const remoteResult = spawnSync(
				'git',
				['remote', 'add', 'origin', 'git@github.com:Flying-Pillow/mission.git'],
				{ cwd: workspaceRoot, stdio: 'pipe' }
			);
			if (remoteResult.status !== 0) {
				throw new Error('Failed to add git remote for repository identity test.');
			}

			expect(deriveRepositoryIdentity(workspaceRoot)).toMatchObject({
				repositoryId: 'github:Flying-Pillow:mission',
				githubRepository: 'Flying-Pillow/mission'
			});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});