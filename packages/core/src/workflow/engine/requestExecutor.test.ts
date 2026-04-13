import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	createInitialMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from './defaultWorkflow.js';
import { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import { FakeAgentRunner } from '../../agent/testing/FakeAgentRunner.js';
import type { MissionTaskRuntimeState, MissionWorkflowRequest } from './types.js';

function createDescriptor(): MissionDescriptor {
	return {
		missionId: 'mission-17',
		missionDir: '/tmp/mission-17',
		branchRef: 'mission/17-reconstruct-agent-runtime-unification',
		createdAt: '2026-04-10T21:00:07.000Z',
		brief: {
			title: 'Reconstruct agent runtime unification'
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
});