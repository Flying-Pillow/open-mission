import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemAdapter } from './FilesystemAdapter.js';
import { createDefaultWorkflowSettings, DEFAULT_WORKFLOW_VERSION } from '../workflow/engine/defaultWorkflow.js';
import { createMissionWorkflowConfigurationSnapshot } from '../workflow/engine/document.js';

describe('FilesystemAdapter', () => {
	it('derives mission branch names with a normalized title slug', () => {
		const adapter = new FilesystemAdapter('/tmp/repo');
		expect(adapter.deriveMissionBranchName(1, 'Bootstrap first real repo from a GitHub issue')).toBe(
			'mission/1-bootstrap-first-real-repo-from-a-github-issue'
		);
	});

	it('resolves the canonical flat mission dossier paths', () => {
		const adapter = new FilesystemAdapter('/tmp/repo');
		const missionDir = adapter.getTrackedMissionDir('mission-101', '/tmp/repo');

		expect(missionDir).toBe(path.join('/tmp/repo', '.mission', 'missions', 'mission-101'));
		expect(adapter.getMissionRuntimeRecordPath(missionDir)).toBe(
			path.join('/tmp/repo', '.mission', 'missions', 'mission-101', 'mission.json')
		);
		expect(adapter.getMissionStagePath(missionDir, 'prd')).toBe(
			path.join('/tmp/repo', '.mission', 'missions', 'mission-101', '01-PRD')
		);
		expect(adapter.getMissionStagePath(missionDir, 'spec')).toBe(
			path.join('/tmp/repo', '.mission', 'missions', 'mission-101', '02-SPEC')
		);
	});

	it('derives mission branch names without a trailing slug when title is empty', () => {
		const adapter = new FilesystemAdapter('/tmp/repo');
		expect(adapter.deriveMissionBranchName(42, '')).toBe('mission/42');
		expect(adapter.deriveMissionBranchName(42)).toBe('mission/42');
	});

	it('derives draft mission branch names with the draft placeholder', () => {
		const adapter = new FilesystemAdapter('/tmp/repo');
		expect(adapter.deriveDraftMissionBranchName('Filesystem mission model')).toMatch(
			/^mission\/draft-\d{14}-filesystem-mission-model$/u
		);
	});

	it('persists and rehydrates the mission descriptor through BRIEF.md', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new FilesystemAdapter('/tmp/repo');
			await adapter.writeMissionDescriptor(missionDir, {
				missionId: 'mission-101-filesystem-model',
				missionDir,
				brief: {
					issueId: 101,
					title: 'Filesystem mission model',
					body: 'Rewrite Mission around structured artifact records.',
					type: 'refactor',
					labels: ['enhancement', 'semantic-model'],
					metadata: {
						owner: 'core',
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
					labels: ['enhancement', 'semantic-model'],
					metadata: {
						owner: 'core',
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
			const adapter = new FilesystemAdapter('/tmp/repo');
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
			const adapter = new FilesystemAdapter('/tmp/repo');
			await adapter.initializeMissionRuntimeRecord({
				missionDir,
				missionId: 'mission-109-runtime-document',
				configuration: createMissionWorkflowConfigurationSnapshot({
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

			const workflowDocument = await adapter.readMissionRuntimeRecord(missionDir);
			expect(workflowDocument?.runtime.tasks).toEqual([]);
		} finally {
			await fs.rm(missionDir, { recursive: true, force: true });
		}
	});

	it('resolves explicit dependsOn arrays and default previous-task dependencies', async () => {
		const missionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-adapter-'));
		try {
			const adapter = new FilesystemAdapter('/tmp/repo');
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
			expect(tasks.map((task) => [task.taskId, task.dependsOn, task.blockedBy])).toEqual([
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
});