import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DaemonClient } from '../client/DaemonClient.js';
import {
	executeCommand,
	getControlStatus,
	getMissionStatus,
	startMission,
	updateControlSetting
} from '../client/operations.js';
import { getMissionDaemonSettingsPath } from '../lib/daemonConfig.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import { startDaemon } from './Daemon.js';
import { getDaemonManifestPath, getDaemonRuntimePath } from './daemonPaths.js';

describe('Daemon', () => {
	it('initializes daemon settings when a workspace first connects', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();
				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					await getControlStatus(client);
					const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');
					expect(JSON.parse(settingsContent)).toMatchObject({
						trackingProvider: 'github'
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('keeps daemon runtime files out of the workspace', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			const manifestPath = getDaemonManifestPath();
			const workspaceDaemonPath = path.join(workspaceRoot, '.missions', 'daemon');

			try {
				const daemon = await startDaemon();
				try {
					const manifestContent = await fs.readFile(manifestPath, 'utf8');
					expect(manifestPath.startsWith(workspaceRoot)).toBe(false);
					expect(JSON.parse(manifestContent)).toMatchObject({
						endpoint: expect.any(Object),
						pid: expect.any(Number),
						protocolVersion: expect.any(Number),
						startedAt: expect.any(String)
					});
					const workspaceLocalDaemonExists = await fs.access(workspaceDaemonPath).then(
						() => true,
						() => false
					);
					expect(workspaceLocalDaemonExists).toBe(false);
				} finally {
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('reports control status when no mission is selected', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const status = await getControlStatus(client);
					const issuesCommand = status.availableCommands?.find((command) => command.command === '/issues');
					const setupCommand = status.availableCommands?.find((command) => command.command === '/setup');

					expect(status.found).toBe(false);
					expect(status.operationalMode).toBe('setup');
					expect(status.control).toMatchObject({
						controlRoot: workspaceRoot,
						initialized: true,
						settingsPresent: true,
						settingsComplete: false,
						issuesConfigured: false
					});
					expect(issuesCommand).toMatchObject({ enabled: false });
					expect(setupCommand).toMatchObject({
						enabled: true,
						flow: expect.objectContaining({
							targetLabel: 'SETUP',
							actionLabel: 'SAVE'
						})
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('derives the GitHub repository from workspace remotes instead of setup settings', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);
			runGit(workspaceRoot, ['remote', 'add', 'origin', 'https://github.com/flying-pillow/mission.git']);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const status = await getControlStatus(client);
					const setupCommand = status.availableCommands?.find((command) => command.command === '/setup');
					const setupFields = setupCommand?.flow?.steps[0];

					expect(status.control).toMatchObject({
						githubRepository: 'flying-pillow/mission',
						issuesConfigured: true
					});
					expect(setupFields && 'options' in setupFields ? setupFields.options.map((option) => option.id) : []).toEqual([
						'agentRunner',
						'defaultAgentMode',
						'defaultModel',
						'cockpitTheme',
						'instructionsPath',
						'skillsPath'
					]);
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('persists control agent runner defaults and marks setup complete once configured', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					await updateControlSetting(client, 'agentRunner', 'copilot');
					await updateControlSetting(client, 'defaultAgentMode', 'interactive');
					const status = await updateControlSetting(client, 'defaultModel', 'gpt-5.4');
					const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

					expect(status.found).toBe(false);
					expect(status.operationalMode).toBe('root');
					expect(status.control).toMatchObject({
						settingsComplete: true,
						settings: expect.objectContaining({
							agentRunner: 'copilot',
							defaultAgentMode: 'interactive',
							defaultModel: 'gpt-5.4'
						})
					});
					expect(JSON.parse(settingsContent)).toMatchObject({
						agentRunner: 'copilot',
						defaultAgentMode: 'interactive',
						defaultModel: 'gpt-5.4'
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('persists selection-backed setup values through command execution flow', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const result = await executeCommand(client, {
					commandId: 'control.setup.edit',
					steps: [
						{
							kind: 'selection',
							stepId: 'field',
							optionIds: ['agentRunner']
						},
						{
							kind: 'selection',
							stepId: 'value',
							optionIds: ['copilot']
						}
					]
				});
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(result.status).toMatchObject({
					control: expect.objectContaining({
						settings: expect.objectContaining({
							agentRunner: 'copilot'
						})
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					agentRunner: 'copilot'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('persists control setting updates through the daemon', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const status = await updateControlSetting(client, 'instructionsPath', '/tmp/mission-instructions');
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(status.found).toBe(false);
				expect(status.control).toMatchObject({
					settingsPresent: true,
					settings: expect.objectContaining({
						instructionsPath: '/tmp/mission-instructions'
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					instructionsPath: '/tmp/mission-instructions'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('persists cockpit theme settings through the daemon', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const status = await updateControlSetting(client, 'cockpitTheme', 'mono');
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(status.found).toBe(false);
				expect(status.control).toMatchObject({
					settingsPresent: true,
					settings: expect.objectContaining({
						cockpitTheme: 'mono'
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					cockpitTheme: 'mono'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('resolves missions by explicit missionId without an ambient active mission', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const firstStatus = await startMission(client, {
					brief: createBrief(101, 'First architecture slice')
				});
				const secondStatus = await startMission(client, {
					brief: createBrief(102, 'Second architecture slice')
				});
				const firstMissionId = firstStatus.missionId;
				const secondMissionId = secondStatus.missionId;

				expect(firstMissionId).toBeTruthy();
				expect(secondMissionId).toBeTruthy();
				if (!firstMissionId || !secondMissionId) {
					throw new Error('Expected both started missions to return mission ids.');
				}
				expect(secondMissionId).not.toBe(firstMissionId);

				const selectedFirst = await getMissionStatus(client, { missionId: firstMissionId });
				const selectedSecond = await getMissionStatus(client, { missionId: secondMissionId });
				const idleStatus = await getControlStatus(client);

				expect(selectedFirst.missionId).toBe(firstMissionId);
				expect(selectedSecond.missionId).toBe(secondMissionId);
				expect(idleStatus.found).toBe(false);
				expect(idleStatus.availableMissions?.map((candidate) => candidate.missionId)).toEqual(
					expect.arrayContaining([firstMissionId, secondMissionId])
				);
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('rejects mission-plane operations without an explicit missionId selector', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				await startMission(client, {
					brief: createBrief(103, 'Explicit mission identity')
				});

				await expect(getMissionStatus(client, {})).rejects.toThrow(
					'explicit missionId selector'
				);
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('materializes a mission worktree without switching the control repo branch', async () => {
		const workspaceRoot = await createTempRepo();
		const initialBranch = readGitOutput(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);

		try {
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const status = await startMission(client, {
					brief: createBrief(104, 'Worktree backed mission layout')
				});
				const missionId = status.missionId;
				const missionDir = status.missionDir;

				if (!missionId || !missionDir || !status.branchRef) {
					throw new Error('Expected mission start to return missionId, missionDir, and branchRef.');
				}

				expect(missionDir).toBe(path.join(workspaceRoot, '.missions', 'active', missionId, 'workspace'));
				expect(status.missionRootDir).toBe(path.join(workspaceRoot, '.missions', 'active', missionId));
				expect(status.flightDeckDir).toBe(path.join(workspaceRoot, '.missions', 'active', missionId, 'flight-deck'));
				expect(await fs.access(path.join(missionDir, '.git')).then(() => true, () => false)).toBe(true);
				expect(readGitOutput(missionDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(status.branchRef);
				expect(readGitOutput(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(initialBranch);
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});

function createBrief(issueId: number, title: string) {
	return {
		issueId,
		title,
		body: `${title} body`,
		type: 'refactor' as const
	};
}

async function createTempRepo(): Promise<string> {
	const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-'));
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

function readGitOutput(workspaceRoot: string, args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
	return result.stdout.trim();
}

async function withTemporaryDaemonConfigHome(run: () => Promise<void>): Promise<void> {
	const previousConfigHome = process.env['XDG_CONFIG_HOME'];
	const configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
	process.env['XDG_CONFIG_HOME'] = configHome;
	try {
		await run();
	} finally {
		if (previousConfigHome === undefined) {
			delete process.env['XDG_CONFIG_HOME'];
		} else {
			process.env['XDG_CONFIG_HOME'] = previousConfigHome;
		}
		await fs.rm(configHome, { recursive: true, force: true });
	}
}
