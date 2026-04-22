import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureMissionConfig,
	getMissionGitHubCliBinary,
	getMissionRuntimeDirectory,
	getMissionConfigPath,
	listRegisteredRepositories,
	registerMissionRepo,
	readMissionConfig,
	writeMissionConfig
} from './config.js';
import { deriveRepositoryIdentity } from './repositoryIdentity.js';

describe('config', () => {
	beforeEach(() => {
		delete process.env['MISSION_CONFIG_PATH'];
	});

	afterEach(async () => {
		const configHome = process.env['XDG_CONFIG_HOME'];
		if (configHome) {
			await fs.rm(configHome, { recursive: true, force: true });
			delete process.env['XDG_CONFIG_HOME'];
		}
		delete process.env['MISSION_CONFIG_PATH'];
	});

	it('scaffolds a default user config in XDG config home', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		const config = await ensureMissionConfig();

		expect(getMissionConfigPath()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'config.json'));
		expect(config).toMatchObject({
			version: 1,
			missionWorkspaceRoot: 'missions'
		});
	});

	it('derives a Mission-managed runtime directory next to the user config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		expect(getMissionRuntimeDirectory()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'runtime'));
	});

	it('prefers MISSION_CONFIG_PATH when present and resolves the Mission config beneath it', () => {
		process.env['MISSION_CONFIG_PATH'] = '/config';

		expect(getMissionConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionRuntimeDirectory()).toBe('/config/mission/runtime');
	});

	it('accepts MISSION_CONFIG_PATH values that already point at the Mission config directory', () => {
		process.env['MISSION_CONFIG_PATH'] = '/config/mission';

		expect(getMissionConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionRuntimeDirectory()).toBe('/config/mission/runtime');
	});

	it('persists user-level overrides', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		await writeMissionConfig({
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});

		expect(readMissionConfig()).toMatchObject({
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('drops legacy terminalBinary values from existing user config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		await fs.mkdir(path.dirname(getMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionConfigPath(),
			JSON.stringify({
				version: 1,
				missionWorkspaceRoot: '/tmp/missions',
				terminalBinary: '/usr/local/bin/zellij',
				ghBinary: '/opt/gh/bin/gh'
			}, null, 2),
			'utf8'
		);

		expect(readMissionConfig()).toEqual({
			version: 1,
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('resolves the configured GitHub CLI binary when Mission install has configured one', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		const binaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-gh-binary-'));
		const ghBinaryPath = path.join(binaryDirectory, 'gh');
		await fs.writeFile(ghBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

		expect(getMissionGitHubCliBinary()).toBeUndefined();

		await writeMissionConfig({
			ghBinary: ghBinaryPath
		});

		expect(getMissionGitHubCliBinary()).toBe(ghBinaryPath);
	});

	it('ignores a configured GitHub CLI path when the binary no longer exists', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		await writeMissionConfig({
			ghBinary: '/tmp/mission-fake-gh-does-not-exist/gh'
		});

		expect(getMissionGitHubCliBinary()).toBeUndefined();
	});

	it('does not read legacy repos-map config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		await fs.mkdir(path.dirname(getMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionConfigPath(),
			JSON.stringify({
				version: 1,
				repos: {
					'github:Flying-Pillow/mission': {
						checkoutPath: '/home/ronald/mission'
					}
				}
			}, null, 2),
			'utf8'
		);

		expect(readMissionConfig()).toEqual({
			version: 1,
			missionWorkspaceRoot: 'missions'
		});
	});

	it('registers a repository checkout in user config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-registered-repo-'));

		try {
			runGit(workspaceRoot, ['init']);
			runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
			runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
			await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
			runGit(workspaceRoot, ['add', 'README.md']);
			runGit(workspaceRoot, ['commit', '-m', 'init']);
			runGit(workspaceRoot, ['remote', 'add', 'origin', 'https://github.com/Flying-Pillow/mission.git']);

			await registerMissionRepo(workspaceRoot);
			const repositoryIdentity = deriveRepositoryIdentity(workspaceRoot);

			expect(readMissionConfig()).toMatchObject({
				registeredRepositories: [
					{
						repositoryId: repositoryIdentity.repositoryId,
						repositoryRootPath: workspaceRoot
					}
				]
			});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('lists registered repositories from config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-registered-repo-'));

		try {
			runGit(workspaceRoot, ['init']);
			runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
			runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
			await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
			runGit(workspaceRoot, ['add', 'README.md']);
			runGit(workspaceRoot, ['commit', '-m', 'init']);
			runGit(workspaceRoot, ['remote', 'add', 'origin', 'https://github.com/Flying-Pillow/mission.git']);

			await registerMissionRepo(workspaceRoot);
			const repositories = await listRegisteredRepositories();
			const repositoryIdentity = deriveRepositoryIdentity(workspaceRoot);

			expect(repositories).toEqual([
				{
					repositoryId: repositoryIdentity.repositoryId,
					repositoryRootPath: workspaceRoot,
					label: 'mission',
					description: 'Flying-Pillow/mission',
					githubRepository: 'Flying-Pillow/mission'
				}
			]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('canonicalizes linked worktree registrations to the shared control root', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-registered-repo-'));
		const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-registered-worktree-'));
		const worktreePath = path.join(worktreeRoot, 'linked');

		try {
			runGit(workspaceRoot, ['init']);
			runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
			runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
			await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
			runGit(workspaceRoot, ['add', 'README.md']);
			runGit(workspaceRoot, ['commit', '-m', 'init']);
			runGit(workspaceRoot, ['worktree', 'add', worktreePath, '-b', 'mission/test-canonicalize']);

			await writeMissionConfig({
				registeredRepositories: [
					{
						repositoryId: 'stale-id',
						repositoryRootPath: worktreePath
					}
				]
			});
			const repositoryIdentity = deriveRepositoryIdentity(workspaceRoot);

			expect(readMissionConfig()).toMatchObject({
				registeredRepositories: [
					{
						repositoryId: repositoryIdentity.repositoryId,
						repositoryRootPath: workspaceRoot
					}
				]
			});
		} finally {
			runGit(workspaceRoot, ['worktree', 'remove', '--force', worktreePath]);
			await fs.rm(worktreeRoot, { recursive: true, force: true });
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('rewrites stale registered repositories out of user config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		await fs.mkdir(path.dirname(getMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionConfigPath(),
			JSON.stringify({
				version: 1,
				missionWorkspaceRoot: 'missions',
				terminalBinary: 'zellij',
				registeredRepositories: [
					{
						checkoutPath: '/tmp/mission-stale-repository'
					}
				]
			}, null, 2),
			'utf8'
		);

		const config = await ensureMissionConfig();

		expect(config).toEqual({
			version: 1,
			missionWorkspaceRoot: 'missions'
		});
		expect(readMissionConfig()).toEqual(config);
		expect(await fs.readFile(getMissionConfigPath(), 'utf8')).not.toContain('mission-stale-repository');
		expect(await fs.readFile(getMissionConfigPath(), 'utf8')).not.toContain('terminalBinary');
	});
});

function runGit(workspaceRoot: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
}