import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MissionAgentContext } from '../../agents/agentContext.js';
import {
	MissionAgentEventEmitter,
	createEmptyMissionAgentConsoleState,
	createEmptyMissionAgentSessionState,
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentDisposable,
	type MissionAgentEvent,
	type MissionAgentRuntime,
	type MissionAgentRuntimeAvailability,
	type MissionAgentRuntimeCapabilities,
	type MissionAgentSession,
	type MissionAgentTurnRequest
} from '../MissionAgentRuntime.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { Factory } from './Factory.js';
import type { MissionStageStatus } from '../../types.js';

describe('Mission', () => {
	it('creates the mission environment and only materializes the first stage on creation', async () => {
		const repoRoot = await createTempRepo();
		try {
			const adapter = new FilesystemAdapter(repoRoot);
			const mission = await Factory.create(adapter, {
				brief: {
					issueId: 101,
					title: 'Filesystem mission model',
					body: 'Rewrite Mission around staged class instances.',
					type: 'refactor'
				},
				branchRef: adapter.deriveMissionBranchName(101, 'Filesystem mission model'),
				agentContext: MissionAgentContext.build()
			});

			const status = await mission.status();
			expect(status.found).toBe(true);
			expect(status.stage).toBe('prd');
			expect(status.readyTasks?.map((task) => task.subject)).toEqual(['PRD From Brief']);
			expect(status.activeTasks ?? []).toEqual([]);
			expect(Object.keys(status.productFiles ?? {}).sort()).toEqual(['brief', 'prd']);
			expect(status.stages?.map((stage: MissionStageStatus) => `${stage.stage}:${stage.taskCount}`)).toEqual([
				'prd:1',
				'spec:0',
				'plan:0',
				'implementation:0',
				'verification:0',
				'audit:0'
			]);
			mission.dispose();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('materializes spec and plan as separate stages with their own templates and tasks', async () => {
		const repoRoot = await createTempRepo();
		try {
			const adapter = new FilesystemAdapter(repoRoot);
			const mission = await Factory.create(adapter, {
				brief: {
					issueId: 102,
					title: 'Advance mission stage',
					body: 'Exercise the stage activation path.',
					type: 'task'
				},
				branchRef: adapter.deriveMissionBranchName(102, 'Advance mission stage'),
				agentContext: MissionAgentContext.build()
			});

			const [prdTask] = await adapter.listTaskStates(mission.getMissionDir(), 'prd');
			if (!prdTask) {
				throw new Error('Expected the PRD stage to contain an initial task.');
			}
			await adapter.updateTaskState(prdTask, { status: 'done' });
			await mission.transition('spec');

			const specStatus = await mission.status();
			expect(specStatus.stage).toBe('spec');
			expect(specStatus.activeTasks?.map((task) => task.subject)).toEqual(['Spec From PRD']);
			expect(Object.keys(specStatus.productFiles ?? {}).sort()).toEqual(['brief', 'prd', 'spec']);
			expect(specStatus.stages?.map((stage: MissionStageStatus) => `${stage.stage}:${stage.taskCount}`)).toEqual([
				'prd:1',
				'spec:1',
				'plan:0',
				'implementation:0',
				'verification:0',
				'audit:0'
			]);

			const [specTask] = await adapter.listTaskStates(mission.getMissionDir(), 'spec');
			if (!specTask) {
				throw new Error('Expected the SPEC stage to contain an initial task.');
			}
			await adapter.updateTaskState(specTask, { status: 'done' });
			await mission.transition('plan');

			const planStatus = await mission.status();
			expect(planStatus.stage).toBe('plan');
			expect(planStatus.activeTasks?.map((task) => task.subject)).toEqual(['Plan From Spec']);
			expect(Object.keys(planStatus.productFiles ?? {}).sort()).toEqual([
				'brief',
				'plan',
				'prd',
				'spec'
			]);
			expect(planStatus.stages?.map((stage: MissionStageStatus) => `${stage.stage}:${stage.taskCount}`)).toEqual([
				'prd:1',
				'spec:1',
				'plan:1',
				'implementation:0',
				'verification:0',
				'audit:0'
			]);
			mission.dispose();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('reports delivery state from mission.json rather than BRIEF frontmatter', async () => {
		const repoRoot = await createTempRepo();
		try {
			const adapter = new FilesystemAdapter(repoRoot);
			const mission = await Factory.create(adapter, {
				brief: {
					issueId: 103,
					title: 'Mission control delivery state',
					body: 'Read delivery state from mission.json.',
					type: 'task'
				},
				branchRef: adapter.deriveMissionBranchName(103, 'Mission control delivery state'),
				agentContext: MissionAgentContext.build()
			});

			await adapter.setMissionDeliveredAt(mission.getMissionDir(), '2026-04-01T12:34:56.000Z');

			const status = await mission.status();
			expect(status.deliveredAt).toBe('2026-04-01T12:34:56.000Z');

			const brief = await adapter.readArtifactRecord(mission.getMissionDir(), 'brief');
			expect(brief?.attributes['deliveredAt']).toBeUndefined();
			mission.dispose();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('surfaces multiple ready and active tasks when dependencies allow parallel work', async () => {
		const repoRoot = await createTempRepo();
		try {
			const adapter = new FilesystemAdapter(repoRoot);
			const mission = await Factory.create(adapter, {
				brief: {
					issueId: 104,
					title: 'Parallel implementation slices',
					body: 'Allow dependency-driven parallel work inside one stage.',
					type: 'feature'
				},
				branchRef: adapter.deriveMissionBranchName(104, 'Parallel implementation slices'),
				agentContext: MissionAgentContext.build()
			});

			await completeStage(adapter, mission.getMissionDir(), 'prd');
			await mission.transition('spec');
			await completeStage(adapter, mission.getMissionDir(), 'spec');
			await mission.transition('plan');
			await completeStage(adapter, mission.getMissionDir(), 'plan');
			await mission.transition('implementation');

			await adapter.writeTaskRecord(mission.getMissionDir(), 'implementation', '01-base.md', {
				subject: 'Base',
				instruction: 'Lay the shared base.',
				agent: 'copilot'
			});
			await adapter.writeTaskRecord(mission.getMissionDir(), 'implementation', '02-api.md', {
				subject: 'API',
				instruction: 'Build the API slice.',
				dependsOn: ['01-base'],
				agent: 'copilot'
			});
			await adapter.writeTaskRecord(mission.getMissionDir(), 'implementation', '03-ui.md', {
				subject: 'UI',
				instruction: 'Build the UI slice.',
				dependsOn: ['01-base'],
				agent: 'copilot'
			});
			await adapter.writeTaskRecord(mission.getMissionDir(), 'implementation', '04-polish.md', {
				subject: 'Polish',
				instruction: 'Integrate both slices.',
				dependsOn: ['02-api', '03-ui'],
				agent: 'copilot'
			});

			let status = await mission.status();
			expect(status.readyTasks?.map((task) => task.taskId)).toEqual(['implementation/01-base']);

			await mission.updateTaskState('implementation/01-base', { status: 'done' });
			status = await mission.status();
			expect(status.readyTasks?.map((task) => task.taskId)).toEqual([
				'implementation/02-api',
				'implementation/03-ui'
			]);

			await mission.updateTaskState('implementation/02-api', { status: 'active' });
			await mission.updateTaskState('implementation/03-ui', { status: 'active' });
			status = await mission.status();
			expect(status.activeTasks?.map((task) => task.taskId)).toEqual([
				'implementation/02-api',
				'implementation/03-ui'
			]);
			expect(status.readyTasks ?? []).toEqual([]);

			await expect(
				mission.updateTaskState('implementation/04-polish', { status: 'active' })
			).rejects.toThrow(/waiting on/u);

			await mission.updateTaskState('implementation/02-api', { status: 'done' });
			await mission.updateTaskState('implementation/03-ui', { status: 'done' });
			status = await mission.status();
			expect(status.readyTasks?.map((task) => task.taskId)).toEqual(['implementation/04-polish']);
			mission.dispose();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	it('launches task-owned agent sessions through the AgentSession domain object', async () => {
		const repoRoot = await createTempRepo();
		try {
			const adapter = new FilesystemAdapter(repoRoot);
			const mission = await Factory.create(adapter, {
				brief: {
					issueId: 105,
					title: 'Task owned agent session',
					body: 'Attach agent sessions to tasks rather than the mission aggregate.',
					type: 'refactor'
				},
				branchRef: adapter.deriveMissionBranchName(105, 'Task owned agent session'),
				agentContext: MissionAgentContext.build()
			});

			const runtime = new TestRuntime('test-runtime', 'Test Runtime');
			mission.registerAgentRuntime(runtime);

			const status = await mission.status();
			const taskId = status.readyTasks?.[0]?.taskId;
			if (!taskId) {
				throw new Error('Expected a ready task to exist for agent launch.');
			}

			const sessionRecord = await mission.launchAgentSession({
				runtimeId: runtime.id,
				taskId,
				workingDirectory: mission.getMissionDir(),
				prompt: 'Complete the task-owned session refactor.'
			});

			expect(sessionRecord.taskId).toBe(taskId);
			expect(sessionRecord.assignmentLabel).toContain('tasks/PRD/');
			expect(runtime.lastSubmittedTurn?.scope).toMatchObject({
				kind: 'slice',
				taskId
			});

			const updatedStatus = await mission.status();
			expect(updatedStatus.activeTasks?.map((task) => task.taskId)).toContain(taskId);
			mission.dispose();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});

const TEST_RUNTIME_CAPABILITIES: MissionAgentRuntimeCapabilities = {
	persistentSessions: true,
	interactiveInput: true,
	scopedPrompts: true,
	resumableSessions: true,
	toolPermissionRequests: false,
	contextWindowVisibility: false,
	tokenUsageVisibility: false,
	costVisibility: false,
	customInstructions: false,
	telemetry: false,
	interruptible: true
};

class TestRuntime implements MissionAgentRuntime {
	private nextSessionIndex = 1;
	public lastSession?: TestSession;
	public lastSubmittedTurn?: MissionAgentTurnRequest;

	public constructor(
		public readonly id: string,
		public readonly displayName: string
	) {}

	public get capabilities(): MissionAgentRuntimeCapabilities {
		return TEST_RUNTIME_CAPABILITIES;
	}

	public async isAvailable(): Promise<MissionAgentRuntimeAvailability> {
		return { available: true };
	}

	public async createSession(): Promise<MissionAgentSession> {
		const session = new TestSession(this.id, this.displayName, `session-${String(this.nextSessionIndex++)}`);
		this.lastSession = session;
		session.onDidEvent((event) => {
			if (event.type === 'session-state-changed') {
				this.lastSubmittedTurn = {
					workingDirectory: event.state.workingDirectory ?? process.cwd(),
					prompt: event.state.currentTurnTitle ?? '',
					...(event.state.scope ? { scope: event.state.scope } : {})
				};
			}
		});
		return session;
	}
}

class TestSession implements MissionAgentSession {
	private readonly consoleEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly eventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private consoleState: MissionAgentConsoleState;
	private sessionState;

	public constructor(
		public readonly runtimeId: string,
		runtimeLabel: string,
		public readonly sessionId: string
	) {
		this.consoleState = createEmptyMissionAgentConsoleState({
			runtimeId,
			runtimeLabel,
			sessionId
		});
		this.sessionState = createEmptyMissionAgentSessionState({
			runtimeId,
			runtimeLabel,
			sessionId
		});
	}

	public get capabilities(): MissionAgentRuntimeCapabilities {
		return TEST_RUNTIME_CAPABILITIES;
	}

	public readonly onDidConsoleEvent = (listener: (event: MissionAgentConsoleEvent) => void): MissionAgentDisposable =>
		this.consoleEmitter.event(listener);

	public readonly onDidEvent = (listener: (event: MissionAgentEvent) => void): MissionAgentDisposable =>
		this.eventEmitter.event(listener);

	public getConsoleState(): MissionAgentConsoleState {
		return this.consoleState;
	}

	public getSessionState() {
		return this.sessionState;
	}

	public async submitTurn(request: MissionAgentTurnRequest): Promise<void> {
		this.sessionState = {
			...this.sessionState,
			lifecycleState: 'running' as const,
			workingDirectory: request.workingDirectory,
			currentTurnTitle: request.title ?? request.prompt,
			...(request.scope ? { scope: request.scope } : {}),
			lastUpdatedAt: new Date().toISOString()
		};
		this.eventEmitter.fire({
			type: 'session-state-changed',
			state: this.sessionState
		});
	}

	public async sendInput(): Promise<void> {}

	public async cancel(reason?: string): Promise<void> {
		this.sessionState = {
			...this.sessionState,
			lifecycleState: 'cancelled' as const,
			...(reason ? { failureMessage: reason } : {}),
			lastUpdatedAt: new Date().toISOString()
		};
	}

	public async terminate(reason?: string): Promise<void> {
		await this.cancel(reason);
	}

	public dispose(): void {
		this.consoleEmitter.dispose();
		this.eventEmitter.dispose();
	}
}

async function completeStage(
	adapter: FilesystemAdapter,
	missionDir: string,
	stage: 'prd' | 'spec' | 'plan'
): Promise<void> {
	const tasks = await adapter.listTaskStates(missionDir, stage);
	for (const task of tasks) {
		await adapter.updateTaskState(task, { status: 'done' });
	}
}

async function createTempRepo(): Promise<string> {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-core-'));
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