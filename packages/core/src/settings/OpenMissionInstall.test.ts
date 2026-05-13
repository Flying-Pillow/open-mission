import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureOpenMissionConfig,
	getOpenMissionGitHubCliBinary,
	getOpenMissionRuntimeDirectory,
	getOpenMissionManagedDependenciesRoot,
	getOpenMissionConfigPath,
	readOpenMissionConfig,
	writeOpenMissionConfig
} from './OpenMissionInstall.js';

describe('config', () => {
	beforeEach(() => {
		delete process.env['OPEN_MISSION_CONFIG_PATH'];
		delete process.env['MISSIONS_PATH'];
		delete process.env['REPOSITORIES_PATH'];
	});

	afterEach(async () => {
		const configHome = process.env['XDG_CONFIG_HOME'];
		if (configHome) {
			await fs.rm(configHome, { recursive: true, force: true });
			delete process.env['XDG_CONFIG_HOME'];
		}
		delete process.env['OPEN_MISSION_CONFIG_PATH'];
		delete process.env['MISSIONS_PATH'];
		delete process.env['REPOSITORIES_PATH'];
	});

	it('scaffolds a default config in XDG config home', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		const config = await ensureOpenMissionConfig();

		expect(getOpenMissionConfigPath()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'open-mission', 'config.json'));
		expect(config).toMatchObject({
			version: 1,
			missionsRoot: path.join(os.homedir(), 'missions'),
			repositoriesRoot: path.join(os.homedir(), 'repositories'),
			defaultAgentAdapter: 'codex',
			enabledAgentAdapters: []
		});
	});

	it('derives Open Mission-managed directories next to the config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		expect(getOpenMissionRuntimeDirectory()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'open-mission', 'runtime'));
		expect(getOpenMissionManagedDependenciesRoot()).toBe(path.join(process.env['XDG_CONFIG_HOME'], 'open-mission', 'dependencies'));
	});

	it('prefers OPEN_MISSION_CONFIG_PATH when present and resolves the Open Mission config beneath it', () => {
		process.env['OPEN_MISSION_CONFIG_PATH'] = '/config';

		expect(getOpenMissionConfigPath()).toBe('/config/open-mission/config.json');
		expect(getOpenMissionRuntimeDirectory()).toBe('/config/open-mission/runtime');
		expect(getOpenMissionManagedDependenciesRoot()).toBe('/config/open-mission/dependencies');
	});

	it('accepts OPEN_MISSION_CONFIG_PATH values that already point at the Open Mission config directory', () => {
		process.env['OPEN_MISSION_CONFIG_PATH'] = '/config/open-mission';

		expect(getOpenMissionConfigPath()).toBe('/config/open-mission/config.json');
		expect(getOpenMissionRuntimeDirectory()).toBe('/config/open-mission/runtime');
		expect(getOpenMissionManagedDependenciesRoot()).toBe('/config/open-mission/dependencies');
	});

	it('persists config overrides', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		await writeOpenMissionConfig({
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			defaultAgentAdapter: 'copilot',
			enabledAgentAdapters: ['copilot', 'codex'],
			ghBinary: '/opt/gh/bin/gh'
		});

		expect(readOpenMissionConfig()).toMatchObject({
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			defaultAgentAdapter: 'copilot',
			enabledAgentAdapters: ['copilot', 'codex'],
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('drops legacy terminalBinary values from existing config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		await fs.mkdir(path.dirname(getOpenMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getOpenMissionConfigPath(),
			JSON.stringify({
				version: 1,
				missionsRoot: '/tmp/missions',
				repositoriesRoot: '/tmp/repositories',
				terminalBinary: '/usr/local/bin/zellij',
				ghBinary: '/opt/gh/bin/gh'
			}, null, 2),
			'utf8'
		);

		expect(readOpenMissionConfig()).toEqual({
			version: 1,
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			defaultAgentAdapter: 'codex',
			enabledAgentAdapters: [],
			ghBinary: '/opt/gh/bin/gh'
		});
	});

	it('resolves the configured GitHub CLI binary when Mission install has configured one', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		const binaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-gh-binary-'));
		const ghBinaryPath = path.join(binaryDirectory, 'gh');
		await fs.writeFile(ghBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

		expect(getOpenMissionGitHubCliBinary()).toBeUndefined();

		await writeOpenMissionConfig({
			ghBinary: ghBinaryPath
		});

		expect(getOpenMissionGitHubCliBinary()).toBe(ghBinaryPath);
	});

	it('ignores a configured GitHub CLI path when the binary no longer exists', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));

		await writeOpenMissionConfig({
			ghBinary: '/tmp/mission-fake-gh-does-not-exist/gh'
		});

		expect(getOpenMissionGitHubCliBinary()).toBeUndefined();
	});

	it('rejects legacy repos-map config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		await fs.mkdir(path.dirname(getOpenMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getOpenMissionConfigPath(),
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

		expect(readOpenMissionConfig()).toBeUndefined();
	});

	it('rewrites stale repository registry entries out of config', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
		await fs.mkdir(path.dirname(getOpenMissionConfigPath()), { recursive: true });
		await fs.writeFile(
			getOpenMissionConfigPath(),
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

		const config = await ensureOpenMissionConfig();

		expect(config).toEqual({
			version: 1,
			missionsRoot: '/tmp/missions',
			repositoriesRoot: '/tmp/repositories',
			defaultAgentAdapter: 'codex',
			enabledAgentAdapters: []
		});
		expect(readOpenMissionConfig()).toEqual(config);
		expect(await fs.readFile(getOpenMissionConfigPath(), 'utf8')).not.toContain('mission-stale-repository');
		expect(await fs.readFile(getOpenMissionConfigPath(), 'utf8')).not.toContain('terminalBinary');
	});
});