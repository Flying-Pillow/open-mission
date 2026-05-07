import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureMissionConfig,
	getMissionGitHubCliBinary,
	getMissionDaemonDirectory,
	getMissionManagedDependenciesRoot,
	getMissionConfigPath,
	readMissionConfig,
	writeMissionConfig
} from './MissionInstall.js';

describe('config', () => {
	beforeEach(() => {
		delete process.env['MISSION_CONFIG_PATH'];
		delete process.env['MISSIONS_PATH'];
		delete process.env['REPOSITORIES_PATH'];
	});

	afterEach(async () => {
		const configHome = process.env['XDG_CONFIG_HOME'];
		if (configHome) {
			await fs.rm(configHome, { recursive: true, force: true });
			delete process.env['XDG_CONFIG_HOME'];
		}
		delete process.env['MISSION_CONFIG_PATH'];
		delete process.env['MISSIONS_PATH'];
		delete process.env['REPOSITORIES_PATH'];
	});

	it('scaffolds a default config in XDG config home', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		const config = await ensureMissionConfig();

		expect(getMissionConfigPath()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'config.json'));
		expect(config).toMatchObject({
			version: 1,
			missionsRoot: path.join(os.homedir(), 'missions'),
			repositoriesRoot: path.join(os.homedir(), 'repositories')
		});
	});

	it('derives Mission-managed directories next to the config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		expect(getMissionDaemonDirectory()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'runtime'));
		expect(getMissionManagedDependenciesRoot()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'mission', 'dependencies'));
	});

	it('prefers MISSION_CONFIG_PATH when present and resolves the Mission config beneath it', () => {
		process.env['MISSION_CONFIG_PATH'] = '/config';

		expect(getMissionConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionDaemonDirectory()).toBe('/config/mission/runtime');
		expect(getMissionManagedDependenciesRoot()).toBe('/config/mission/dependencies');
	});

	it('accepts MISSION_CONFIG_PATH values that already point at the Mission config directory', () => {
		process.env['MISSION_CONFIG_PATH'] = '/config/mission';

		expect(getMissionConfigPath()).toBe('/config/mission/config.json');
		expect(getMissionDaemonDirectory()).toBe('/config/mission/runtime');
		expect(getMissionManagedDependenciesRoot()).toBe('/config/mission/dependencies');
	});

	it('persists config overrides', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		await writeMissionConfig({
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			ghBinary: '/opt/gh/bin/gh'
		});

		expect(readMissionConfig()).toMatchObject({
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('drops legacy terminalBinary values from existing config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		await fs.mkdir(path.dirname(getMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionConfigPath(),
			JSON.stringify({
				version: 1,
				missionsRoot: '/tmp/missions',
				repositoriesRoot: '/tmp/repositories',
				terminalBinary: '/usr/local/bin/zellij',
				ghBinary: '/opt/gh/bin/gh'
			}, null, 2),
			'utf8'
		);

		expect(readMissionConfig()).toEqual({
			version: 1,
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('resolves the configured GitHub CLI binary when Mission install has configured one', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
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
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		await writeMissionConfig({
			ghBinary: '/tmp/mission-fake-gh-does-not-exist/gh'
		});

		expect(getMissionGitHubCliBinary()).toBeUndefined();
	});

	it('rejects legacy repos-map config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
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

		expect(readMissionConfig()).toBeUndefined();
	});

	it('rewrites stale repository registry entries out of config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		await fs.mkdir(path.dirname(getMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getMissionConfigPath(),
			JSON.stringify({
				version: 1,
				missionsRoot: '/tmp/missions',
				repositoriesRoot: '/tmp/repositories',
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
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories'
		});
		expect(readMissionConfig()).toEqual(config);
		expect(await fs.readFile(getMissionConfigPath(), 'utf8')).not.toContain('mission-stale-repository');
		expect(await fs.readFile(getMissionConfigPath(), 'utf8')).not.toContain('terminalBinary');
	});
});