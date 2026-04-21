import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureMissionUserConfig,
	getMissionGitHubCliBinary,
	getMissionRuntimeDirectory,
	getMissionUserConfigPath,
	listRegisteredMissionUserRepos,
	registerMissionUserRepo,
	readMissionUserConfig,
	writeMissionUserConfig
} from './userConfig.js';

describe('userConfig', () => {
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

		const config = await ensureMissionUserConfig();

		expect(getMissionUserConfigPath()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'config.json'));
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

		expect(getMissionUserConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionRuntimeDirectory()).toBe('/config/mission/runtime');
	});

	it('accepts MISSION_CONFIG_PATH values that already point at the Mission config directory', () => {
		process.env['MISSION_CONFIG_PATH'] = '/config/mission';

		expect(getMissionUserConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionRuntimeDirectory()).toBe('/config/mission/runtime');
	});

	it('persists user-level overrides', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		await writeMissionUserConfig({
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});

		expect(readMissionUserConfig()).toMatchObject({
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('drops legacy terminalBinary values from existing user config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		await fs.mkdir(path.dirname(getMissionUserConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionUserConfigPath(),
			JSON.stringify({
				version: 1,
				missionWorkspaceRoot: '/tmp/missions',
				terminalBinary: '/usr/local/bin/zellij',
				ghBinary: '/opt/gh/bin/gh'
			}, null, 2),
			'utf8'
		);

		expect(readMissionUserConfig()).toEqual({
			version: 1,
			missionWorkspaceRoot: '/tmp/missions',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('resolves the configured GitHub CLI binary when Mission install has configured one', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		expect(getMissionGitHubCliBinary()).toBeUndefined();

		await writeMissionUserConfig({
			ghBinary: '/opt/gh/bin/gh'
		});

		expect(getMissionGitHubCliBinary()).toBe('/opt/gh/bin/gh');
	});

	it('ignores a configured GitHub CLI path when the binary no longer exists', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		await writeMissionUserConfig({
			ghBinary: '/tmp/mission-fake-gh-does-not-exist/gh'
		});

		expect(getMissionGitHubCliBinary()).toBeUndefined();
	});

	it('does not read legacy repos-map config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));
		await fs.mkdir(path.dirname(getMissionUserConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionUserConfigPath(),
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

		expect(readMissionUserConfig()).toEqual({
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

			await registerMissionUserRepo(workspaceRoot);

			expect(readMissionUserConfig()).toMatchObject({
				registeredRepositories: [
					{
						checkoutPath: workspaceRoot
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

			await registerMissionUserRepo(workspaceRoot);
			const repositories = await listRegisteredMissionUserRepos();

			expect(repositories).toEqual([
				{
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

			await writeMissionUserConfig({
				registeredRepositories: [{ checkoutPath: worktreePath }]
			});

			expect(readMissionUserConfig()).toMatchObject({
				registeredRepositories: [
					{
						checkoutPath: workspaceRoot
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
		await fs.mkdir(path.dirname(getMissionUserConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionUserConfigPath(),
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

		const config = await ensureMissionUserConfig();

		expect(config).toEqual({
			version: 1,
			missionWorkspaceRoot: 'missions'
		});
		expect(readMissionUserConfig()).toEqual(config);
		expect(await fs.readFile(getMissionUserConfigPath(), 'utf8')).not.toContain('mission-stale-repository');
		expect(await fs.readFile(getMissionUserConfigPath(), 'utf8')).not.toContain('terminalBinary');
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