import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DaemonApi } from '../client/DaemonApi.js';
import { DaemonClient } from '../client/DaemonClient.js';
import { getMissionDaemonSettingsPath } from '../lib/daemonConfig.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import { startDaemon } from './Daemon.js';
import { getDaemonManifestPath, getDaemonRuntimePath } from './daemonPaths.js';

describe('Daemon', () => {
	it('does not initialize daemon settings when a workspace first connects', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();
				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const settingsExists = await fs.access(getMissionDaemonSettingsPath(workspaceRoot)).then(
						() => true,
						() => false
					);

					expect(settingsExists).toBe(false);
					expect(status.operationalMode).toBe('setup');
					expect(status.control).toMatchObject({
						initialized: false,
						settingsPresent: false,
						settingsComplete: false
					});
					expect(status.control?.problems).toEqual(
						expect.arrayContaining([
							'Mission control scaffolding is missing.',
							'Mission settings are missing.'
						])
					);
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('serves workflow settings through the dedicated daemon API and emits update events', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					const initialized = await api.control.initializeWorkflowSettings();
					const initial = await api.control.getWorkflowSettings();
					const eventPromise = new Promise<unknown>((resolve) => {
						const subscription = client.onDidEvent((event) => {
							if (event.type === 'control.workflow.settings.updated') {
								subscription.dispose();
								resolve(event);
							}
						});
					});

					const updated = await api.control.updateWorkflowSettings({
						expectedRevision: initial.revision,
						patch: [
							{
								op: 'replace',
								path: '/execution/maxParallelTasks',
								value: 2
							}
						],
						context: {
							requestedBySurface: 'test-suite',
							requestedBy: 'vitest'
						}
					});
					const event = await eventPromise;

					expect(initialized.metadata.initialized).toBe(true);
					expect(updated.workflow.execution.maxParallelTasks).toBe(2);
					expect(updated.status.control?.settings.workflow?.execution.maxParallelTasks).toBe(2);
					expect(event).toMatchObject({
						type: 'control.workflow.settings.updated',
						revision: updated.revision,
						changedPaths: ['/execution/maxParallelTasks']
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

	it('rejects workflow updates with stale revisions after out-of-band edits', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					await api.control.initializeWorkflowSettings();
					const initial = await api.control.getWorkflowSettings();
					const settingsPath = getMissionDaemonSettingsPath(workspaceRoot);
					const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
					settings['workflow'] = {
						...(settings['workflow'] as Record<string, unknown>),
						execution: {
							maxParallelTasks: 3,
							maxParallelSessions: 1
						}
					};
					await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

					await expect(
						api.control.updateWorkflowSettings({
							expectedRevision: initial.revision,
							patch: [
								{
									op: 'replace',
									path: '/execution/maxParallelSessions',
									value: 4
								}
							],
							context: {
								requestedBySurface: 'test-suite',
								requestedBy: 'vitest'
							}
						})
					).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' });
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
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const issuesCommand = status.availableActions?.find((action) => action.action === '/issues');
					const setupCommand = status.availableActions?.find((action) => action.action === '/setup');

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
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const setupCommand = status.availableActions?.find((action) => action.action === '/setup');
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
					const api = new DaemonApi(client);
					await api.control.updateSetting('agentRunner', 'copilot');
					await api.control.updateSetting('defaultAgentMode', 'interactive');
					const status = await api.control.updateSetting('defaultModel', 'gpt-5.4');
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
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const result = await api.control.executeAction('control.setup.edit', [
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
				]);
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(result).toMatchObject({
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
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const status = await api.control.updateSetting('instructionsPath', '/tmp/mission-instructions');
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
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const status = await api.control.updateSetting('cockpitTheme', 'mono');
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

	it('prepares a repository bootstrap pull request before mission authorization when scaffolding is missing', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromBrief({
							brief: createBrief(undefined, 'Bootstrap authorization')
						});
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status.preparation).toMatchObject({
							kind: 'repository-bootstrap',
							state: 'pull-request-opened',
							baseBranch: 'master'
						});
						expect(status.missionId).toBeUndefined();
						expect(status.recommendedAction).toContain('bootstrap PR');
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['pr', 'create']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});

	it('creates a GitHub issue and then prepares a mission pull request from a brief', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromBrief({
							brief: createBrief(undefined, 'Brief-backed authorization')
						});
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							issueId: 900,
							type: 'refactor',
							preparation: expect.objectContaining({
								kind: 'mission',
								state: 'pull-request-opened',
								issueId: 900
							})
						});
						expect(status.missionRootDir).toContain(path.join('.missions', 'missions'));
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['api', 'repos/Flying-Pillow/mission/issues'],
							['pr', 'create']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});

	it('prepares a mission pull request from an existing issue without creating a new issue', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromIssue(42);
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							issueId: 42,
							preparation: expect.objectContaining({
								kind: 'mission',
								state: 'pull-request-opened',
								issueId: 42
							})
						});
						expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
							['auth', 'status'],
							['issue', 'view', '42'],
							['pr', 'create', '--title']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});
});

function createBrief(issueId: number | undefined, title: string) {
	return {
		...(issueId !== undefined ? { issueId } : {}),
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

async function createTempBareRemote(): Promise<string> {
	const remoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-origin-'));
	runGit(remoteRoot, ['init', '--bare']);
	return remoteRoot;
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

async function withFakeGitHubCli(
	run: (context: { callsPath: string }) => Promise<void>
): Promise<void> {
	const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-fake-gh-'));
	const callsPath = path.join(fakeHome, 'gh-calls.ndjson');
	const statePath = path.join(fakeHome, 'gh-state.json');
	const ghPath = path.join(fakeHome, 'gh');
	const previousAuthorName = process.env['GIT_AUTHOR_NAME'];
	const previousAuthorEmail = process.env['GIT_AUTHOR_EMAIL'];
	const previousCommitterName = process.env['GIT_COMMITTER_NAME'];
	const previousCommitterEmail = process.env['GIT_COMMITTER_EMAIL'];
	const script = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const callsPath = ${JSON.stringify(callsPath)};
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
function recordCall() {
	fs.appendFileSync(callsPath, JSON.stringify({ args }) + '\n');
}
function readState() {
	try {
		return JSON.parse(fs.readFileSync(statePath, 'utf8'));
	} catch {
		return { nextIssueNumber: 900, issues: {} };
	}
}
function writeState(state) {
	fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
}
function findArg(flag) {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}
function parseFormValue(key) {
	const prefix = key + '=';
	for (let index = 0; index < args.length - 1; index += 1) {
		if (args[index] === '-f' && String(args[index + 1]).startsWith(prefix)) {
			return String(args[index + 1]).slice(prefix.length);
		}
	}
	return undefined;
}
recordCall();
if (args[0] === 'auth' && args[1] === 'status') {
	process.stdout.write('Logged in to github.com as mission-test\n');
	process.exit(0);
}
if (args[0] === 'api' && args[1] === 'user') {
	process.stdout.write('mission-test\n');
	process.exit(0);
}
if (args[0] === 'api' && typeof args[1] === 'string' && args[1].startsWith('repos/')) {
	const state = readState();
	const number = state.nextIssueNumber++;
	const issue = {
		number,
		title: parseFormValue('title') || 'Created issue',
		body: parseFormValue('body') || 'Created body',
		url: 'https://github.com/Flying-Pillow/mission/issues/' + String(number),
		labels: []
	};
	state.issues[String(number)] = issue;
	writeState(state);
	process.stdout.write(JSON.stringify(issue));
	process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'view') {
	const issueId = String(args[2] || '0');
	const state = readState();
	const issue = state.issues[issueId] || {
		number: Number(issueId),
		title: 'Existing issue ' + issueId,
		body: 'Existing issue ' + issueId + ' body',
		url: 'https://github.com/Flying-Pillow/mission/issues/' + issueId,
		labels: []
	};
	process.stdout.write(JSON.stringify(issue));
	process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'list') {
	process.stdout.write('[]');
	process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
	const head = findArg('--head') || 'proposal';
	process.stdout.write('https://github.com/Flying-Pillow/mission/pull/' + encodeURIComponent(head) + '\n');
	process.exit(0);
}
process.stderr.write('Unsupported fake gh invocation: ' + args.join(' ') + '\n');
process.exit(1);
`;
	const previousPath = process.env['PATH'];
	await fs.writeFile(ghPath, script, 'utf8');
	await fs.chmod(ghPath, 0o755);
	process.env['PATH'] = `${fakeHome}:${previousPath ?? ''}`;
	process.env['GIT_AUTHOR_NAME'] = 'Mission Test';
	process.env['GIT_AUTHOR_EMAIL'] = 'mission@example.com';
	process.env['GIT_COMMITTER_NAME'] = 'Mission Test';
	process.env['GIT_COMMITTER_EMAIL'] = 'mission@example.com';
	try {
		await run({ callsPath });
	} finally {
		if (previousPath === undefined) {
			delete process.env['PATH'];
		} else {
			process.env['PATH'] = previousPath;
		}
		if (previousAuthorName === undefined) {
			delete process.env['GIT_AUTHOR_NAME'];
		} else {
			process.env['GIT_AUTHOR_NAME'] = previousAuthorName;
		}
		if (previousAuthorEmail === undefined) {
			delete process.env['GIT_AUTHOR_EMAIL'];
		} else {
			process.env['GIT_AUTHOR_EMAIL'] = previousAuthorEmail;
		}
		if (previousCommitterName === undefined) {
			delete process.env['GIT_COMMITTER_NAME'];
		} else {
			process.env['GIT_COMMITTER_NAME'] = previousCommitterName;
		}
		if (previousCommitterEmail === undefined) {
			delete process.env['GIT_COMMITTER_EMAIL'];
		} else {
			process.env['GIT_COMMITTER_EMAIL'] = previousCommitterEmail;
		}
	}
}

async function readFakeGitHubCalls(callsPath: string): Promise<Array<{ args: string[] }>> {
	const content = await fs.readFile(callsPath, 'utf8');
	return content
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { args: string[] });
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
