import { describe, expect, it } from 'vitest';
import type { MissionDescriptor, MissionTaskState } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	createInitialMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import { FakeAgentRunner } from '../../daemon/runtime/agent/testing/FakeAgentRunner.js';
import type { MissionTaskRuntimeState, MissionWorkflowRequest } from './types.js';
import type { AgentSessionReference } from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import type { AgentSession } from '../../daemon/runtime/agent/AgentSession.js';

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
		waitingOnTaskIds: [],
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
			waitingOn: [],
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
					artifactTasks: true,
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

	it('does not ingest stage task artifacts when artifact-backed generation is disabled', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const adapter = {
			writeArtifactRecord: async () => undefined,
			listTaskStates: async (_missionDir: string, stage: string) =>
				stage === 'implementation'
					? [{
						taskId: 'implementation/01-from-artifact',
						stage: 'implementation',
						sequence: 1,
						subject: 'From Artifact',
						instruction: 'Promote artifact-defined implementation task into runtime generation.',
						body: 'Promote artifact-defined implementation task into runtime generation.',
						dependsOn: [],
						waitingOn: [],
						status: 'pending',
						agent: 'copilot',
						retries: 0,
						fileName: '01-from-artifact.md',
						filePath: '/tmp/mission-17/.mission/missions/mission-17/03-IMPLEMENTATION/tasks/01-from-artifact.md',
						relativePath: '03-IMPLEMENTATION/tasks/01-from-artifact.md'
					} satisfies MissionTaskState]
					: [],
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
					artifactTasks: false,
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
				requestId: 'request-generate-implementation-without-artifacts',
				type: 'tasks.request-generation',
				payload: {
					stageId: 'implementation'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(events[0]).toMatchObject({
			type: 'tasks.generated',
			stageId: 'implementation',
			tasks: []
		});
	});

	it('normalizes default sequential dependencies for generated spec tasks', async () => {
		const runner = new FakeAgentRunner('fake-runner', 'Fake Runner', 'terminal');
		const adapter = {
			writeArtifactRecord: async () => undefined,
			listTaskStates: async () => [],
			writeTaskRecord: async () => undefined
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

		const events = await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-generate-spec',
				type: 'tasks.request-generation',
				payload: {
					stageId: 'spec'
				}
			} satisfies MissionWorkflowRequest]
		});

		expect(events[0]).toMatchObject({
			type: 'tasks.generated',
			stageId: 'spec',
			tasks: [
				{
					taskId: 'spec/01-spec-from-prd',
					dependsOn: []
				},
				{
					taskId: 'spec/02-plan',
					dependsOn: ['spec/01-spec-from-prd']
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
		expect(startedEvent?.sessionId).toBe('fake-runner-session-1');
	});

	it('starts a new runtime session id when relaunching the same task after termination', async () => {
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

		const firstLaunchEvents = await executor.executeRequests({
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

		const firstSessionId = firstLaunchEvents.find((event) => event.type === 'session.started')?.sessionId;
		if (!firstSessionId) {
			throw new Error('Expected first launch to emit session.started.');
		}

		await executor.terminateRuntimeSession(firstSessionId, 'restart task', task.taskId);

		const secondLaunchEvents = await executor.executeRequests({
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

		const secondSessionId = secondLaunchEvents.find((event) => event.type === 'session.started')?.sessionId;
		if (!secondSessionId) {
			throw new Error('Expected second launch to emit session.started.');
		}

		expect(secondSessionId).not.toBe(firstSessionId);
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

	it('emits task.completed when a task-scoped runtime session completes successfully', async () => {
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

		await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-complete-session',
				type: 'session.launch',
				payload: {
					taskId: task.taskId,
					runnerId: 'fake-runner'
				}
			} satisfies MissionWorkflowRequest]
		});

		const sessionId = runner.listSessions()[0]?.reference.sessionId;
		if (!sessionId) {
			throw new Error('Expected a launched fake runner session.');
		}

		const events = await executor.completeRuntimeSession(sessionId, task.taskId);

		expect(events).toEqual([
			expect.objectContaining({
				type: 'session.completed',
				sessionId,
				taskId: task.taskId
			}),
			expect.objectContaining({
				type: 'task.completed',
				taskId: task.taskId
			})
		]);
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
				waitingOn: [],
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

	it('appends generic rework context to the next launch prompt', async () => {
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
				waitingOn: [],
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
		const task = createTask({
			pendingLaunchContext: {
				source: 'rework',
				requestId: 'task.reworked:implementation/03-align-workflow-request-execution-with-unified-runtime:2026-04-10T21:13:00.000Z',
				createdAt: '2026-04-10T21:13:00.000Z',
				actor: 'workflow',
				reasonCode: 'verification.failed',
				summary: 'The previous attempt still leaked a transport-specific boundary.',
				sourceTaskId: 'implementation/03-align-workflow-request-execution-with-unified-runtime-check',
				artifactRefs: [
					{ path: 'artifacts/review-notes.md', title: 'Review Notes' },
					{ path: 'artifacts/review-diff.md' }
				]
			}
		});
		runtime.tasks = [task];

		await executor.executeRequests({
			missionId: 'mission-17',
			descriptor: createDescriptor(),
			configuration,
			runtime,
			requests: [{
				requestId: 'request-rework-launch',
				type: 'session.launch',
				payload: {
					taskId: task.taskId,
					runnerId: 'fake-runner',
					prompt: 'Operator supplied launch prompt.'
				}
			} satisfies MissionWorkflowRequest]
		});

		const prompt = runner.getLastStartRequest()?.initialPrompt?.text;
		expect(prompt).toContain('Operator supplied launch prompt.');
		expect(prompt).toContain('Rework context:');
		expect(prompt).toContain('Actor: workflow');
		expect(prompt).toContain('Reason code: verification.failed');
		expect(prompt).toContain('Source task: implementation/03-align-workflow-request-execution-with-unified-runtime-check');
		expect(prompt).toContain('Review Notes: @artifacts/review-notes.md');
		expect(prompt).toContain('@artifacts/review-diff.md');
	});

	it('does not synthesize termination when runtime session reattach fails', async () => {
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
			terminalHandle: {
				sessionName: 'stale-running-session',
				paneId: 'pty'
			},
			lifecycle: 'running',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z'
		}];

		const events = await executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime
		});

		expect(events).toEqual([]);
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
			terminalHandle: {
				sessionName: 'terminated-session',
				paneId: 'pty'
			},
			lifecycle: 'terminated',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z',
			terminatedAt: '2026-04-10T21:16:00.000Z'
		}];

		await expect(executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime
		})).resolves.toEqual([]);
	});

	it('treats workflow termination of an unattached session as a terminal lifecycle event', async () => {
		const executor = new MissionWorkflowRequestExecutor({
			adapter: {} as FilesystemAdapter,
			runners: new Map()
		});

		const events = await executor.terminateRuntimeSession(
			'detached-session',
			'terminated by panic',
			'spec/01'
		);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'session.terminated',
			sessionId: 'detached-session',
			taskId: 'spec/01'
		});
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
			terminalHandle: {
				sessionName: 'detached-session',
				paneId: 'pty'
			},
			lifecycle: 'running',
			launchedAt: '2026-04-10T21:15:00.000Z',
			updatedAt: '2026-04-10T21:15:00.000Z'
		}];

		const events = await executor.reconcileSessions({
			schemaVersion: 1,
			missionId: 'mission-17',
			configuration,
			runtime
		});

		expect(events).toContainEqual(expect.objectContaining({
			type: 'session.terminated',
			sessionId: 'detached-session',
			taskId: task.taskId
		}));
	});
});