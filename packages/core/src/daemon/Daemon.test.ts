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
import { getMissionSettingsPath } from '../lib/repoConfig.js';
import { startDaemon } from './Daemon.js';
import { getDaemonManifestPath, getDaemonRuntimePath } from './daemonPaths.js';

describe('Daemon', () => {
	it('scaffolds the control repository when the daemon starts', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot, socketPath: path.join(repoRoot, '.mission-daemon-test.sock') });
			try {
				const settingsContent = await fs.readFile(getMissionSettingsPath(repoRoot), 'utf8');
				expect(JSON.parse(settingsContent)).toMatchObject({
					trackingProvider: 'github'
				});
			} finally {
				await daemon.close();
			}
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('keeps daemon runtime files out of the repository', async () => {
		const repoRoot = await createTempRepo();
		const manifestPath = getDaemonManifestPath(repoRoot);
		const repoDaemonPath = path.join(repoRoot, '.mission', 'daemon');

		try {
			const daemon = await startDaemon({ repoRoot });
			try {
				const manifestContent = await fs.readFile(manifestPath, 'utf8');
				expect(manifestPath.startsWith(repoRoot)).toBe(false);
				expect(JSON.parse(manifestContent)).toMatchObject({
					repoRoot
				});
				const repoLocalDaemonExists = await fs.access(repoDaemonPath).then(
					() => true,
					() => false
				);
				expect(repoLocalDaemonExists).toBe(false);
			} finally {
				await daemon.close();
			}

			const runtimePathExists = await fs.access(getDaemonRuntimePath(repoRoot)).then(
				() => true,
				() => false
			);
			expect(runtimePathExists).toBe(false);
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('reports control status when no mission is selected', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
				const status = await getControlStatus(client);
				const issuesCommand = status.availableCommands?.find((command) => command.command === '/issues');
				const setupCommand = status.availableCommands?.find((command) => command.command === '/setup');

				expect(status.found).toBe(false);
				expect(status.operationalMode).toBe('setup');
				expect(status.control).toMatchObject({
					controlRepoRoot: repoRoot,
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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('derives the GitHub repository from workspace remotes instead of setup settings', async () => {
		const repoRoot = await createTempRepo();
		runGit(repoRoot, ['remote', 'add', 'origin', 'https://github.com/flying-pillow/mission.git']);

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
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
					'instructionsPath',
					'skillsPath'
				]);
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('persists control agent runner defaults and marks setup complete once configured', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
				await updateControlSetting(client, 'agentRunner', 'copilot');
				await updateControlSetting(client, 'defaultAgentMode', 'interactive');
				const status = await updateControlSetting(client, 'defaultModel', 'gpt-5.4');
				const settingsContent = await fs.readFile(getMissionSettingsPath(repoRoot), 'utf8');

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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('persists selection-backed setup values through command execution flow', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
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
				const settingsContent = await fs.readFile(getMissionSettingsPath(repoRoot), 'utf8');

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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('persists control setting updates through the daemon', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
				const status = await updateControlSetting(client, 'instructionsPath', '/tmp/mission-instructions');
				const settingsContent = await fs.readFile(getMissionSettingsPath(repoRoot), 'utf8');

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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('resolves missions by explicit missionId without an ambient active mission', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('rejects mission-plane operations without an explicit missionId selector', async () => {
		const repoRoot = await createTempRepo();

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
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
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('materializes a mission worktree without switching the control repo branch', async () => {
		const repoRoot = await createTempRepo();
		const initialBranch = readGitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);

		try {
			const daemon = await startDaemon({ repoRoot });
			const client = new DaemonClient();

			try {
				await client.connect({ repoRoot });
				const status = await startMission(client, {
					brief: createBrief(104, 'Worktree backed mission layout')
				});
				const missionId = status.missionId;
				const missionDir = status.missionDir;

				if (!missionId || !missionDir || !status.branchRef) {
					throw new Error('Expected mission start to return missionId, missionDir, and branchRef.');
				}

				expect(missionDir).toBe(path.join(repoRoot, '.mission', 'worktrees', missionId));
				expect(await fs.access(path.join(missionDir, '.git')).then(() => true, () => false)).toBe(true);
				expect(readGitOutput(missionDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(status.branchRef);
				expect(readGitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(initialBranch);
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
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
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-'));
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

function readGitOutput(repoRoot: string, args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
	return result.stdout.trim();
}
