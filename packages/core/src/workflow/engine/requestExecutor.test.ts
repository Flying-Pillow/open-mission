import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { AgentRunner } from '../../runtime/AgentRunner.js';
import type { AgentSession } from '../../runtime/AgentSession.js';
import type { AgentSessionStartRequest } from '../../runtime/AgentRuntimeTypes.js';
import {
	createInitialMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from './defaultWorkflow.js';
import { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import type { MissionTaskRuntimeState, MissionWorkflowRequest } from './types.js';

class FakeSession implements AgentSession {
	public readonly runnerId: string;
	public readonly transportId: string | undefined;
	public readonly sessionId: string;
	private readonly snapshot;

	public constructor(input: { runnerId: string; transportId?: string; sessionId: string; taskId: string }) {
		this.runnerId = input.runnerId;
		this.transportId = input.transportId;
		this.sessionId = input.sessionId;
		this.snapshot = {
			runnerId: input.runnerId,
			...(input.transportId ? { transportId: input.transportId } : {}),
			sessionId: input.sessionId,
			missionId: 'mission-17',
			taskId: input.taskId,
			phase: 'running' as const,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt'] as const,
			awaitingInput: false,
			updatedAt: '2026-04-10T21:30:00.000Z'
		};
	}

	public getSnapshot() {
		return {
			...this.snapshot,
			acceptedCommands: [...this.snapshot.acceptedCommands]
		};
	}

	public onDidEvent(): { dispose(): void } {
		return {
			dispose() {
				return;
			}
		};
	}

	public async submitPrompt() {
		return this.getSnapshot();
	}

	public async submitCommand() {
		return this.getSnapshot();
	}

	public async cancel() {
		return this.getSnapshot();
	}

	public async terminate() {
		return this.getSnapshot();
	}

	public dispose(): void {
		return;
	}
}

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
			autostart: false,
			launchMode: 'manual'
		},
		retries: 0,
		createdAt: '2026-04-10T21:12:10.000Z',
		updatedAt: '2026-04-10T21:12:10.000Z',
		...task
	};
}

describe('MissionWorkflowRequestExecutor', () => {
	it('launches sessions from runnerId request payloads and emits runnerId session facts', async () => {
		const startedRequests: AgentSessionStartRequest[] = [];
		const runner: AgentRunner = {
			id: 'fake-runner',
			transportId: 'terminal',
			displayName: 'Fake Runner',
			capabilities: {
				attachableSessions: false,
				promptSubmission: true,
				structuredCommands: true,
				interruptible: true,
				interactiveInput: false,
				telemetry: false,
				mcpClient: false
			},
			isAvailable: async () => ({ available: true }),
			startSession: async (request) => {
				startedRequests.push(request);
				return new FakeSession({
					runnerId: 'fake-runner',
					transportId: 'terminal',
					sessionId: 'session-1',
					taskId: request.taskId
				});
			}
		};

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

		expect(startedRequests).toHaveLength(1);
		expect(startedRequests[0]?.taskId).toBe(task.taskId);

		const startedEvent = events.find((event) => event.type === 'session.started');
		expect(startedEvent).toBeDefined();
		expect(startedEvent).toMatchObject({
			type: 'session.started',
			taskId: task.taskId,
			runnerId: 'fake-runner',
			transportId: 'terminal'
		});
	});
});