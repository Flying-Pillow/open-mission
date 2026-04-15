import { describe, expect, it } from 'vitest';
import type { MissionDescriptor, MissionTaskState } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	createInitialMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from './defaultWorkflow.js';
import { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import { FakeAgentRunner } from '../../agent/testing/FakeAgentRunner.js';
import type { MissionTaskRuntimeState, MissionWorkflowRequest } from './types.js';
import type { AgentSessionReference } from '../../agent/AgentRuntimeTypes.js';
import type { AgentSession } from '../../agent/AgentSession.js';

function createDescriptor(): MissionDescriptor {
	return {
		missionId: 'mission-17',
		missionDir: '/tmp/mission-17',
		branchRef: 'mission/17-reconstruct-agent-runtime-unification',
		createdAt: '2026-04-10T21:00:07.000Z',
		brief: {
			title: 'Reconstruct agent runtime unification',
			body: 'Reconstruct agent runtime unification body',
			type: 'refactor'
		}
	} as MissionDescriptor;
}

function createTask(task: Partial<MissionTaskRuntimeState> = {}): MissionTaskRuntimeState {
	return {
		taskId: 'implementation/03-align-workflow-request-execution-with-unified-runtime',
		stageId: 'implementation',
		title: 'Align Workflow Request Execution With Unified Runtime',
		instruction: 'Launch through the unified runner path.',
		dependsOn: [],
		lifecycle: 'queued',
		blockedByTaskIds: [],
		runtime: {
			autostart: false
		},
		retries: 0,
		createdAt: '2026-04-10T21:12:10.000Z',
		updatedAt: '2026-04-10T21:12:10.000Z',
		...task
	};
}

describe('MissionWorkflowRequestExecutor', () => {
	it('generates implementation tasks from configured task-generation tasks', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const writtenTasks: Array<{ stage: string; fileName: string }> = [];
		const adapter = {
			writeArtifactRecord: async () => undefined,
			listTaskStates: async () => [],
			writeTaskRecord: async (_missionDir: string, stage: string, fileName: string) => {
				writtenTasks.push({ stage, fileName });
			}
		} as unknown as FilesystemAdapter;

		const executor = new MissionWorkflowRequestExecutor({
			adapter,
			runners: new Map([[runner.id, runner]])
		});
		const workflow = createDefaultWorkflowSettings();
		workflow.taskGeneration = workflow.taskGeneration.map((rule) =>
			rule.stageId === 'implementation'
				? {
					...rule,
					tasks: [
						{
							taskId: 'implementation/01-visible-while-planning',
							title: 'Visible While Planning',
							instruction: 'Keep implementation slices visible while planning executes.',
							dependsOn: []
						}
					]
				}
				: rule
		);
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);

		const events = await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-generate-implementation',
				type: 'tasks.request-generation',
				payload: {
					stageId: 'implementation'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(events[0]).toMatchObject({
			type: 'tasks.generated',
			stageId: 'implementation',
			tasks: [
				{
					taskId: 'implementation/01-visible-while-planning',
					title: 'Visible While Planning'
				}
			]
		});
		expect(writtenTasks).toEqual(
			expect.arrayContaining([
				{ stage: 'implementation', fileName: '01-visible-while-planning.md' }
			])
		);
	});

	it('generates implementation tasks from existing stage task artifacts when workflow rules are empty', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const implementationTaskArtifact: MissionTaskState = {
			taskId: 'implementation/01-from-artifact',
			stage: 'implementation',
			sequence: 1,
			subject: 'From Artifact',
			instruction: 'Promote artifact-defined implementation task into runtime generation.',
			body: 'Promote artifact-defined implementation task into runtime generation.',
			dependsOn: [],
			blockedBy: [],
			status: 'pending',
			agent: 'copilot',
			retries: 0,
			fileName: '01-from-artifact.md',
			filePath: '/tmp/mission-17/.mission/missions/mission-17/03-IMPLEMENTATION/tasks/01-from-artifact.md',
			relativePath: '03-IMPLEMENTATION/tasks/01-from-artifact.md'
		};
		const adapter = {
			writeArtifactRecord: async () => undefined,
			listTaskStates: async (_missionDir: string, stage: string) =>
				stage === 'implementation' ? [implementationTaskArtifact] : [],
			writeTaskRecord: async () => undefined
		} as unknown as FilesystemAdapter;

		const executor = new MissionWorkflowRequestExecutor({
			adapter,
			runners: new Map([[runner.id, runner]])
		});
		const workflow = createDefaultWorkflowSettings();
		workflow.taskGeneration = workflow.taskGeneration.map((rule) =>
			rule.stageId === 'implementation'
				? {
					...rule,
					templateSources: [],
					tasks: []
				}
				: rule
		);
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);

		const events = await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-generate-implementation-from-artifact',
				type: 'tasks.request-generation',
				payload: {
					stageId: 'implementation'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(events[0]).toMatchObject({
			type: 'tasks.generated',
			stageId: 'implementation',
			tasks: [
				{
					taskId: 'implementation/01-from-artifact',
					title: 'From Artifact'
				}
			]
		});
	});

	it('launches sessions from runnerId request payloads and emits runnerId session facts', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');

		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map([[runner.id, runner]])
		});
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow: createDefaultWorkflowSettings()
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
		const task = createTask();
		runtime.tasks = [task];

		const events = await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-1',
				type: 'session.launch',
				payload: {
					taskId: task.taskId,
					runnerId: 'fake-runner'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(runner.getLastStartRequest()?.task.taskId).toBe(task.taskId);

		const startedEvent = events.find((event) => event.type === 'session.started');
		expect(startedEvent).toBeDefined();
		expect(startedEvent).toMatchObject({
			type: 'session.started',
			taskId: task.taskId,
			runnerId: 'fake-runner',
			transportId: 'terminal'
		});
	});

	it('preserves canonical task identity when cancelling an unattached runtime session', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map([[runner.id, runner]])
		});

		await executor.attachSession({
			runnerId: 'fake-runner',
			sessionId: 'session-detached',
			transport: {
				kind: 'terminal',
				terminalSessionName: 'session-detached'
			}
		});

		const events = await executor.cancelRuntimeSession(
			'session-detached',
			'cleanup detached runtime',
			'implementation/03-align-workflow-request-execution-with-unified-runtime'
		);

		expect(events).toContainEqual(expect.objectContaining({
			type: 'session.cancelled',
			sessionId: 'session-detached',
			taskId: 'implementation/03-align-workflow-request-execution-with-unified-runtime'
		}));
	});

	it('builds a task-artifact launch prompt when session.launch has no explicit prompt payload', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const adapter = {
			readTaskState: async () => ({
				taskId: 'implementation/03-align-workflow-request-execution-with-unified-runtime',
				stage: 'implementation',
				sequence: 3,
				subject: 'Align Workflow Request Execution With Unified Runtime',
				instruction: 'Launch through the unified runner path.',
				body: 'Launch through the unified runner path.',
				dependsOn: [],
				blockedBy: [],
				status: 'ready',
				agent: 'fake-runner',
				retries: 0,
				fileName: '03-align-workflow-request-execution-with-unified-runtime.md',
				filePath: '/tmp/mission-17/.mission/missions/mission-17/03-IMPLEMENTATION/tasks/03-align-workflow-request-execution-with-unified-runtime.md',
				relativePath: '03-IMPLEMENTATION/tasks/03-align-workflow-request-execution-with-unified-runtime.md'
			}),
			getMissionWorkspacePath: (missionDir: string) => missionDir
		} as unknown as FilesystemAdapter;

		const executor = new MissionWorkflowRequestExecutor({
			adapter,
			runners: new Map([[runner.id, runner]])
		});
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow: createDefaultWorkflowSettings()
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
		const task = createTask();
		runtime.tasks = [task];

		await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-2',
				type: 'session.launch',
				payload: {
					taskId: task.taskId,
					runnerId: 'fake-runner'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
			'Here are your instructions: @/tmp/mission-17/.mission/missions/mission-17/03-IMPLEMENTATION/tasks/03-align-workflow-request-execution-with-unified-runtime.md'
		);
		expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
			'Perform the task exactly as specified in <03-align-workflow-request-execution-with-unified-runtime.md>.'
		);
	});

	it('reconciles unattached persisted active sessions as terminated when runtime attach fails', async () => {
		class ThrowingReconcileRunner extends FakeAgentRunner {
			protected override async onReconcileSession(_reference: AgentSessionReference): Promise<AgentSession> {
				throw new Error('runtime attach failed');
			}
		}

		const runner = new ThrowingReconcileRunner('fake-runner', 'Fake Runner', 'terminal');
		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map([[runner.id, runner]])
		});
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow: createDefaultWorkflowSettings()
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
		const task = createTask();
		runtime.tasks = [task];
		runtime.sessions = [{
			sessionId: 'stale-running-session',
			taskId: task.taskId,
			runnerId: 'fake-runner',
			transportId: 'terminal',
			terminalSessionName: 'stale-running-session',
			lifecycle: 'running',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z'
		}];

		const events = await executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime,
			eventLog: []
		});

		expect(events).toContainEqual(expect.objectContaining({
			type: 'session.terminated',
			sessionId: 'stale-running-session',
			taskId: task.taskId
		}));
	});

	it('does not reconcile persisted terminal sessions that are already terminated', async () => {
		class ThrowingReconcileRunner extends FakeAgentRunner {
			protected override async onReconcileSession(_reference: AgentSessionReference): Promise<AgentSession> {
				throw new Error('terminated sessions should not be reconciled');
			}
		}

		const runner = new ThrowingReconcileRunner('fake-runner', 'Fake Runner', 'terminal');
		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map([[runner.id, runner]])
		});
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow: createDefaultWorkflowSettings()
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
		const task = createTask();
		runtime.tasks = [task];
		runtime.sessions = [{
			sessionId: 'terminated-session',
			taskId: task.taskId,
			runnerId: 'fake-runner',
			transportId: 'terminal',
			terminalSessionName: 'terminated-session',
			lifecycle: 'terminated',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z',
			terminatedAt: '2026-04-10T21:16:00.000Z'
		}];

		await expect(executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime,
			eventLog: []
		})).resolves.toEqual([]);
	});

	it('reconciles detached terminal snapshots even when runtime snapshot taskId is unknown', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map([[runner.id, runner]])
		});
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-10T21:00:07.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow: createDefaultWorkflowSettings()
		});
		const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
		const task = createTask();
		runtime.tasks = [task];
		runtime.sessions = [{
			sessionId: 'detached-session',
			taskId: task.taskId,
			runnerId: 'fake-runner',
			transportId: 'terminal',
			terminalSessionName: 'detached-session',
			lifecycle: 'running',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z'
		}];

		const events = await executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime,
			eventLog: []
		});

		expect(events).toContainEqual(expect.objectContaining({
			type: 'session.terminated',
			sessionId: 'detached-session',
			taskId: task.taskId
		}));
	});
});