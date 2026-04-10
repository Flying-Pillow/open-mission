import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ensureMissionUserConfig,
	getMissionUserConfigPath,
	listRegisteredMissionUserRepos,
	registerMissionUserRepo,
	readMissionUserConfig,
	writeMissionUserConfig
} from './userConfig.js';

describe('userConfig', () => {
	afterEach(async () => {
		const configHome = process.env['XDG_CONFIG_HOME'];
		if (configHome) {
			await fs.rm(configHome, { recursive: true, force: true });
			delete process.env['XDG_CONFIG_HOME'];
		}
	});

	it('scaffolds a default user config in XDG config home', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		const config = await ensureMissionUserConfig();

		expect(getMissionUserConfigPath()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'config.json'));
		expect(config).toMatchObject({
			version: 1,
			missionWorkspaceRoot: 'missions',
			terminalBinary: 'zellij',
			editorBinary: 'micro'
		});
	});

	it('persists user-level overrides', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-user-config-'));

		await writeMissionUserConfig({
			missionWorkspaceRoot: '/tmp/missions',
			terminalBinary: '/usr/local/bin/zellij',
			editorBinary: 'nano'
		});

		expect(readMissionUserConfig()).toMatchObject({
			missionWorkspaceRoot: '/tmp/missions',
			terminalBinary: '/usr/local/bin/zellij',
			editorBinary: 'nano'
		});
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
			missionWorkspaceRoot: 'missions',
			terminalBinary: 'zellij',
			editorBinary: 'micro'
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