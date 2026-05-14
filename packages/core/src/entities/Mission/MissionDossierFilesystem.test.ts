import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MissionDossierFilesystem } from './MissionDossierFilesystem.js';
import { Repository } from '../Repository/Repository.js';
import { createDefaultWorkflowSettings, DEFAULT_WORKFLOW_VERSION } from '../../workflow/mission/workflow.js';
import { createWorkflowStateData, createWorkflowConfigurationSnapshot } from '../../workflow/engine/document.js';
import { Mission } from './Mission.js';

describe('MissionDossierFilesystem', () => {
	it('derives mission branch names with a normalized title slug', () => {
		const adapter = new MissionDossierFilesystem('/tmp/repo');
		expect(adapter.deriveMissionBranchName(1, 'Bootstrap first real repo from a GitHub issue')).toBe(
			'mission/1-bootstrap-first-real-repo-from-a-github-issue'
		);
	});

	it('resolves the canonical flat mission dossier paths', () => {
		const adapter = new MissionDossierFilesystem('/tmp/repo');
		const missionDir = adapter.getTrackedMissionDir('mission-101', '/tmp/repo');

		expect(missionDir).toBe(path.join('/tmp/repo', '.open-mission', 'missions', 'mission-101'));
		expect(adapter.getWorkflowStateDataPath(missionDir)).toBe(
			path.join('/tmp/repo', '.open-mission', 'missions', 'mission-101', 'mission.json')
		);
		expect(adapter.getMissionStagePath(missionDir, 'prd')).toBe(
			path.join('/tmp/repo', '.open-mission', 'missions', 'mission-101', '01-PRD')
		);
		expect(adapter.getMissionStagePath(missionDir, 'spec')).toBe(
			path.join('/tmp/repo', '.open-mission', 'missions', 'mission-101', '02-SPEC')
		);
	});

	it('appends mission AgentExecution terminal recording events through recorded relative log paths', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-AgentExecution-log-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			const terminalRecordingPath = adapter.getMissionTerminalRecordingRelativePath('AgentExecution-1');

			expect(terminalRecordingPath).toBe('terminal-recordings/AgentExecution-1.terminal.jsonl');
			await adapter.ensureMissionTerminalRecordingFile(missionDir, terminalRecordingPath);
			await adapter.appendMissionTerminalRecordingEvent(missionDir, terminalRecordingPath, {
				type: 'output',
				at: '2026-05-07T00:00:00.000Z',
				data: '\u001b[32mready\u001b[0m\n'
			});

			await expect(adapter.readMissionTerminalRecordingEvents(missionDir, terminalRecordingPath)).resolves.toEqual([{
				type: 'output',
				at: '2026-05-07T00:00:00.000Z',
				data: '\u001b[32mready\u001b[0m\n'
			}]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('rejects legacy raw mission AgentExecution log paths', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-legacy-AgentExecution-log-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await expect(adapter.readMissionTerminalRecordingEvents(missionDir, 'terminal-recordings/AgentExecution-1.log'))
				.rejects.toThrow('must use terminal-recordings/<agentExecutionId>.terminal.jsonl');
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('resolves AgentExecution journal paths separately from terminal recordings', () => {
		const adapter = new MissionDossierFilesystem('/tmp/repo');
		const missionDir = path.join('/tmp/repo', '.open-mission', 'missions', 'mission-1');
		const agentJournalPath = adapter.getAgentExecutionJournalRelativePath('agent-execution-1');

		expect(agentJournalPath).toBe('agent-journals/agent-execution-1.interaction.jsonl');
		expect(adapter.resolveAgentExecutionJournalPath(missionDir, agentJournalPath)).toBe(
			path.join(missionDir, 'agent-journals', 'agent-execution-1.interaction.jsonl')
		);
		expect(() => adapter.resolveAgentExecutionJournalPath(missionDir, 'terminal-recordings/AgentExecution-1.terminal.jsonl'))
			.toThrow('must use agent-journals/<agentExecutionId>.interaction.jsonl');
	});

	it('nests mission worktrees under the full GitHub repository path', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-github-'));
		try {
			const initResult = await import('node:child_process').then(({ spawnSync }) =>
				spawnSync('git', ['init'], { cwd: workspaceRoot, stdio: 'pipe' })
			);
			if (initResult.status !== 0) {
				throw new Error('Failed to initialize temporary git repository for mission path test.');
			}
			const remoteResult = await import('node:child_process').then(({ spawnSync }) =>
				spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:Flying-Pillow/connect-four.git'], {
					cwd: workspaceRoot,
					stdio: 'pipe'
				})
			);
			if (remoteResult.status !== 0) {
				throw new Error('Failed to add git remote for mission path test.');
			}

			const adapter = new MissionDossierFilesystem(workspaceRoot);
			expect(adapter.getMissionWorktreePath('mission-101')).toBe(
				path.join(Repository.resolveMissionsRoot(), 'Flying-Pillow', 'connect-four', 'mission-101')
			);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('uses default mission worktree root while Repository settings are in setup-recoverable invalid state', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-invalid-settings-'));
		try {
			git(workspaceRoot, ['init']);
			git(workspaceRoot, ['remote', 'add', 'origin', 'git@github.com:Flying-Pillow/connect-four.git']);
			await fs.mkdir(path.join(workspaceRoot, '.open-mission'), { recursive: true });
			await fs.writeFile(path.join(workspaceRoot, '.open-mission', 'settings.json'), JSON.stringify({
				missionsRoot: path.join(workspaceRoot, 'legacy-worktrees'),
				trackingProvider: 'github',
				instructionsPath: '.agents',
				skillsPath: '.agents/skills',
				agentRunner: 'copilot-cli'
			}), 'utf8');

			const adapter = new MissionDossierFilesystem(workspaceRoot);
			expect(adapter.getMissionWorktreePath('mission-101')).toBe(
				path.join(Repository.resolveMissionsRoot(), 'Flying-Pillow', 'connect-four', 'mission-101')
			);
			await expect(adapter.listMissions()).resolves.toEqual([]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('rematerializes a missing but still registered Mission worktree', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-stale-worktree-'));
		const worktreePath = path.join(workspaceRoot, '..', 'mission-worktree');

		try {
			git(workspaceRoot, ['init']);
			git(workspaceRoot, ['config', 'user.email', 'mission@example.test']);
			git(workspaceRoot, ['config', 'user.name', 'Mission Test']);
			await fs.writeFile(path.join(workspaceRoot, 'README.md'), 'initial\n', 'utf8');
			git(workspaceRoot, ['add', 'README.md']);
			git(workspaceRoot, ['commit', '-m', 'initial']);
			git(workspaceRoot, ['branch', '-M', 'main']);
			git(workspaceRoot, ['worktree', 'add', '-b', 'mission/1-initial-setup', worktreePath, 'main']);
			await fs.rm(worktreePath, { recursive: true, force: true });

			const adapter = new MissionDossierFilesystem(workspaceRoot);
			await expect(adapter.materializeMissionWorktree(worktreePath, 'mission/1-initial-setup'))
				.resolves.toBe('mission/1-initial-setup');
			expect(git(workspaceRoot, ['-C', worktreePath, 'branch', '--show-current']))
				.toBe('mission/1-initial-setup');
		} finally {
			await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('derives mission branch names without a trailing slug when title is empty', () => {
		const adapter = new MissionDossierFilesystem('/tmp/repo');
		expect(adapter.deriveMissionBranchName(42, '')).toBe('mission/42');
		expect(adapter.deriveMissionBranchName(42)).toBe('mission/42');
	});

	it('derives draft mission branch names with the draft placeholder', () => {
		const adapter = new MissionDossierFilesystem('/tmp/repo');
		expect(adapter.deriveDraftMissionBranchName('Filesystem mission model')).toMatch(
			/^mission\/draft-\d{14}-filesystem-mission-model$/u
		);
	});

	it('commits with a daemon fallback author identity when Git config is clean', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-git-identity-'));
		const isolatedHome = path.join(workspaceRoot, 'home');
		const previousHome = process.env['HOME'];
		const previousAuthorName = process.env['GIT_AUTHOR_NAME'];
		const previousAuthorEmail = process.env['GIT_AUTHOR_EMAIL'];
		const previousCommitterName = process.env['GIT_COMMITTER_NAME'];
		const previousCommitterEmail = process.env['GIT_COMMITTER_EMAIL'];

		try {
			await fs.mkdir(isolatedHome, { recursive: true });
			process.env['HOME'] = isolatedHome;
			delete process.env['GIT_AUTHOR_NAME'];
			delete process.env['GIT_AUTHOR_EMAIL'];
			delete process.env['GIT_COMMITTER_NAME'];
			delete process.env['GIT_COMMITTER_EMAIL'];

			git(workspaceRoot, ['init']);
			await fs.writeFile(path.join(workspaceRoot, 'README.md'), 'prepared\n', 'utf8');

			const adapter = new MissionDossierFilesystem(workspaceRoot);
			adapter.stagePaths(['README.md']);
			expect(() => adapter.commit('prepare repository')).not.toThrow();

			expect(git(workspaceRoot, ['log', '-1', '--format=%an <%ae>|%cn <%ce>'])).toBe(
				'Open Mission Daemon <open-mission-daemon@localhost>|Open Mission Daemon <open-mission-daemon@localhost>'
			);
		} finally {
			restoreEnv('HOME', previousHome);
			restoreEnv('GIT_AUTHOR_NAME', previousAuthorName);
			restoreEnv('GIT_AUTHOR_EMAIL', previousAuthorEmail);
			restoreEnv('GIT_COMMITTER_NAME', previousCommitterName);
			restoreEnv('GIT_COMMITTER_EMAIL', previousCommitterEmail);
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('persists and rehydrates the mission descriptor through BRIEF.md', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await adapter.writeMissionDescriptor(missionDir, {
				missionId: 'mission-101-filesystem-model',
				missionDir,
				brief: {
					issueId: 101,
					title: 'Filesystem mission model',
					body: 'Rewrite Mission around structured artifact records.',
					type: 'refactor',
					assignee: {
						githubLogin: 'octocat',
						githubUserId: 1,
						source: 'manual'
					},
					labels: ['enhancement', 'semantic-model'],
					metadata: {
						scope: 'core',
						track: 'semantic-model'
					}
				},
				branchRef: 'mission/101-filesystem-model',
				createdAt: '2026-04-01T00:00:00.000Z',
				deliveredAt: '2026-04-02T00:00:00.000Z'
			});

			await expect(adapter.readMissionDescriptor(missionDir)).resolves.toEqual({
				missionId: path.basename(missionDir),
				missionDir,
				brief: {
					issueId: 101,
					title: 'Filesystem mission model',
					body: 'Rewrite Mission around structured artifact records.',
					type: 'refactor',
					assignee: {
						githubLogin: 'octocat',
						githubUserId: 1,
						source: 'manual'
					},
					labels: ['enhancement', 'semantic-model'],
					metadata: {
						scope: 'core',
						track: 'semantic-model'
					}
				},
				branchRef: 'mission/101-filesystem-model',
				createdAt: '2026-04-01T00:00:00.000Z',
				deliveredAt: '2026-04-02T00:00:00.000Z'
			});
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('derives the mission title from the BRIEF heading when frontmatter is absent', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await fs.writeFile(
				path.join(missionDir, 'BRIEF.md'),
				[
					'# BRIEF: Filesystem metadata recovery',
					'',
					'Issue: #108',
					'',
					'Recover the display title from the document heading.'
				].join('\n'),
				'utf8'
			);

			await expect(adapter.readMissionDescriptor(missionDir)).resolves.toEqual({
				missionId: path.basename(missionDir),
				missionDir,
				brief: {
					title: 'Filesystem metadata recovery',
					body: 'Recover the display title from the document heading.',
					type: 'task'
				},
				branchRef: '',
				createdAt: expect.any(String)
			});
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('writes task definitions without runtime fallback metadata', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await Mission.initializeStateData({
				adapter,
				missionDir,
				missionId: 'mission-109-runtime-document',
				configuration: createWorkflowConfigurationSnapshot({
					workflowVersion: DEFAULT_WORKFLOW_VERSION,
					workflow: createDefaultWorkflowSettings()
				}),
				createdAt: '2026-04-01T00:00:00.000Z'
			});
			await adapter.writeTaskRecord(missionDir, 'spec', '01-control-plane.md', {
				subject: 'Control Plane',
				instruction: 'Persist workflow state in mission.json.',
				agent: 'planner'
			});

			const taskPath = path.join(adapter.getStageTasksPath(missionDir, 'spec'), '01-control-plane.md');
			const taskContent = await fs.readFile(taskPath, 'utf8');
			expect(taskContent).toContain('agent: "planner"');
			expect(taskContent).not.toContain('status:');
			expect(taskContent).not.toContain('retries:');

			const [task] = await adapter.listTaskStates(missionDir, 'spec');
			expect(task?.status).toBe('pending');
			expect(task?.agent).toBe('planner');

			const workflowDocument = await Mission.readStateData(adapter, missionDir);
			expect(workflowDocument?.runtime.tasks).toEqual([]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('rejects inline legacy event logs in mission runtime data', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			const configuration = createWorkflowConfigurationSnapshot({
				createdAt: '2026-04-01T00:00:00.000Z',
				workflowVersion: DEFAULT_WORKFLOW_VERSION,
				workflow: createDefaultWorkflowSettings()
			});
			const data = createWorkflowStateData({
				missionId: 'mission-inline-event-log',
				configuration,
				createdAt: configuration.createdAt
			});
			await fs.writeFile(
				adapter.getWorkflowStateDataPath(missionDir),
				`${JSON.stringify({
					...data,
					eventLog: [{
						eventId: 'mission.created:legacy',
						type: 'mission.created',
						occurredAt: configuration.createdAt,
						source: 'human',
						payload: {}
					}]
				}, null, 2)}\n`,
				'utf8'
			);

			await expect(Mission.readStateData(adapter, missionDir)).rejects.toThrow(/eventLog/u);
			await expect(Mission.readEventLog(adapter, missionDir)).resolves.toEqual([]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('resolves explicit dependsOn arrays and default previous-task dependencies', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await adapter.writeTaskRecord(missionDir, 'implementation', '01-base.md', {
				subject: 'Base',
				instruction: 'Lay the foundation.',
				agent: 'copilot-cli'
			});
			await adapter.writeTaskRecord(missionDir, 'implementation', '02-api.md', {
				subject: 'API',
				instruction: 'Build the API slice.',
				dependsOn: ['01-base'],
				agent: 'copilot-cli'
			});
			await adapter.writeTaskRecord(missionDir, 'implementation', '03-ui.md', {
				subject: 'UI',
				instruction: 'Build the UI slice.',
				dependsOn: ['01-base'],
				agent: 'copilot-cli'
			});
			await adapter.writeTaskRecord(missionDir, 'implementation', '04-polish.md', {
				subject: 'Polish',
				instruction: 'Integrate the parallel slices.',
				dependsOn: ['02-api', '03-ui'],
				agent: 'copilot-cli'
			});

			const tasks = await adapter.listTaskStates(missionDir, 'implementation');
			expect(tasks.map((task) => [task.taskId, task.dependsOn, task.waitingOn])).toEqual([
				['implementation/01-base', [], []],
				['implementation/02-api', ['implementation/01-base'], ['implementation/01-base']],
				['implementation/03-ui', ['implementation/01-base'], ['implementation/01-base']],
				[
					'implementation/04-polish',
					['implementation/02-api', 'implementation/03-ui'],
					['implementation/02-api', 'implementation/03-ui']
				]
			]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('orders implementation verification pairs after their base task', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new MissionDossierFilesystem('/tmp/repo');
			await adapter.writeTaskRecord(missionDir, 'implementation', '01-base-verify.md', {
				subject: 'Verify Base',
				instruction: 'Validate the base slice.',
				dependsOn: ['01-base'],
				agent: 'copilot-cli'
			});
			await adapter.writeTaskRecord(missionDir, 'implementation', '01-base.md', {
				subject: 'Base',
				instruction: 'Build the base slice.',
				agent: 'copilot-cli'
			});
			await adapter.writeTaskRecord(missionDir, 'implementation', '02-next.md', {
				subject: 'Next',
				instruction: 'Build the next slice.',
				agent: 'copilot-cli'
			});

			const tasks = await adapter.listTaskStates(missionDir, 'implementation');
			expect(tasks.map((task) => [task.taskId, task.dependsOn, task.waitingOn])).toEqual([
				['implementation/01-base', [], []],
				['implementation/01-base-verify', ['implementation/01-base'], ['implementation/01-base']],
				['implementation/02-next', ['implementation/01-base-verify'], ['implementation/01-base-verify']]
			]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});
});

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
		return;
	}
	process.env[key] = value;
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
	}
	return result.stdout.trim();
}