import { describe, expect, it } from 'vitest';
import type { AgentExecutionSnapshot } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { PolicyBoundAgentExecutionSignalPort } from '../signals/AgentExecutionSignalPort.js';
import type {
	AgentExecutionObservation,
	AgentExecutionSignalDecision
} from '../signals/AgentExecutionSignal.js';
import { MissionMcpSignalServer } from './MissionMcpSignalServer.js';

function createSnapshot(
	overrides: Partial<AgentExecutionSnapshot> = {}
): AgentExecutionSnapshot {
	const scope = overrides.scope ?? {
		kind: 'task' as const,
		missionId: 'mission-31',
		taskId: 'task-3',
		stageId: 'implementation'
	};
	return {
		agentId: 'claude-code',
		sessionId: 'session-7',
		workingDirectory: '/missions/Flying-Pillow/mission/31-adopt-sandcastle-agentprovideradapter-for-four-a',
		taskId: 'task-3',
		missionId: 'mission-31',
		stageId: 'implementation',
		status: 'running',
		attention: 'autonomous',
		progress: {
			state: 'working',
			summary: 'Working',
			updatedAt: '2026-05-04T11:59:00.000Z'
		},
		waitingForInput: false,
		acceptsPrompts: true,
		acceptedCommands: [],
		reference: {
			agentId: 'claude-code',
			sessionId: 'session-7'
		},
		startedAt: '2026-05-04T11:58:00.000Z',
		updatedAt: '2026-05-04T11:59:00.000Z',
		...overrides,
		scope
	};
}

describe('MissionMcpSignalServer', () => {
	it('starts local-only, registers sessions, and routes valid calls through the signal policy port', async () => {
		const commits: {
			observation: AgentExecutionObservation;
			decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>;
		}[] = [];
		const snapshots = new Map<string, AgentExecutionSnapshot>([
			['session-7', createSnapshot()]
		]);
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:20:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentExecutionId);
				},
				commit(input) {
					commits.push({
						observation: input.observation,
						decision: input.decision
					});
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });

		const handle = await server.start();
		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['progress', 'note']
		});
		const progressAcknowledgement = await handle.invokeTool('progress', {
			summary: 'Halfway there.',
			detail: '3/6 checklist items are done.'
		}, registration.sessionToken);
		const noteAcknowledgement = await handle.invokeTool('note', {
			text: 'Need a follow-up after the next test run.'
		}, registration.sessionToken);
		const health = await handle.healthCheck();

		expect(handle.localOnly).toBe(true);
		expect(handle.transport).toBe('in-memory-local');
		expect(handle.endpoint).toMatch(/^mission-local:\/\/mcp-signal\//);
		expect(health).toEqual({
			serverId: handle.serverId,
			endpoint: handle.endpoint,
			running: true,
			localOnly: true,
			transport: 'in-memory-local',
			registeredSessionCount: 1
		});
		expect(registration).toEqual({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			sessionToken: expect.any(String),
			allowedTools: ['progress', 'note'],
			endpoint: handle.endpoint,
			localOnly: true,
			transport: 'in-memory-local'
		});
		expect(progressAcknowledgement).toEqual({
			accepted: true,
			outcome: 'promoted',
			sessionStatus: 'running',
			waitingForInput: false
		});
		expect(noteAcknowledgement).toEqual({
			accepted: true,
			outcome: 'recorded',
			sessionStatus: 'running',
			waitingForInput: false
		});
		expect(commits).toHaveLength(2);
		expect(commits[0]?.observation.observationId).toMatch(/^mcp:session-7:/);
		expect(commits[1]?.decision.action).toBe('emit-message');
	});

	it('rejects invalid, disallowed, duplicate, unknown-session-token, and stopped calls', async () => {
		const snapshots = new Map<string, AgentExecutionSnapshot>([
			['session-7', createSnapshot()]
		]);
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:21:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentExecutionId);
				},
				commit() {
					return undefined;
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();
		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['progress']
		});

		expect(await handle.invokeTool('progress', {
			summary: '   '
		}, registration.sessionToken)).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Invalid payload for MCP tool 'progress': summary: Too small: expected string to have >=1 characters"
		});
		expect(await handle.invokeTool('fail', {
			reason: 'This tool should not be available.'
		}, registration.sessionToken)).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission MCP tool 'fail' is not allowed for this execution."
		});
		expect(await handle.invokeTool('progress', {
			summary: 'Accepted once.'
		}, registration.sessionToken)).toEqual({
			accepted: true,
			outcome: 'promoted',
			sessionStatus: 'running',
			waitingForInput: false
		});
		expect(await handle.invokeTool('progress', {
			summary: 'Accepted twice?'
		}, registration.sessionToken)).toEqual({
			accepted: true,
			outcome: 'promoted',
			sessionStatus: 'running',
			waitingForInput: false
		});

		await server.unregisterExecution(registration.sessionToken);

		expect(await handle.invokeTool('progress', {
			summary: 'No longer registered.'
		}, registration.sessionToken)).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: 'Unknown Mission MCP session token.'
		});

		await server.stop();

		expect(await handle.invokeTool('progress', {
			summary: 'Server is down.'
		}, registration.sessionToken)).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: 'Mission MCP signal server is not running.'
		});
	});

	it('rejects ended sessions through the signal policy instead of mutating state directly', async () => {
		const snapshots = new Map<string, AgentExecutionSnapshot>([
			['session-7', createSnapshot({
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:19:00.000Z'
			})]
		]);
		const commits: AgentExecutionObservation[] = [];
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:22:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentExecutionId);
				},
				commit(input) {
					commits.push(input.observation);
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();
		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['progress']
		});

		const acknowledgement = await handle.invokeTool('progress', {
			summary: 'Trying to update a finished execution.'
		}, registration.sessionToken);

		expect(acknowledgement).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission session 'session-7' already ended with status 'completed'."
		});
		expect(commits).toEqual([]);
	});

	it('keeps rejected policy calls out of event id dedupe and validates session registration input', async () => {
		const snapshots = new Map<string, AgentExecutionSnapshot>([
			['session-7', createSnapshot({
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:19:00.000Z'
			})]
		]);
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:23:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentExecutionId);
				},
				commit() {
					throw new Error('commit should not be called for rejected policy signals');
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();

		await expect(server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: '   ',
			allowedTools: ['progress']
		})).rejects.toThrow(
			'Invalid Mission MCP session registration: agentExecutionId: Too small: expected string to have >=1 characters'
		);

		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['progress']
		});

		const firstAcknowledgement = await handle.invokeTool('progress', {
			summary: 'Trying again after completion.'
		}, registration.sessionToken);
		const retryAcknowledgement = await handle.invokeTool('progress', {
			summary: 'Trying again after completion.'
		}, registration.sessionToken);

		expect(firstAcknowledgement).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission session 'session-7' already ended with status 'completed'."
		});
		expect(retryAcknowledgement).toEqual(firstAcknowledgement);
	});

	it('routes allowlisted entity commands through the daemon entity command executor', async () => {
		const executed: unknown[] = [];
		const server = new MissionMcpSignalServer({
			signalPort: new PolicyBoundAgentExecutionSignalPort({
				sink: {
					getSnapshot: async () => undefined,
					commit: async () => undefined
				}
			}),
			executeEntityCommand: async (input) => {
				executed.push(input);
				return { ok: true, commandId: input.commandId };
			}
		});
		const handle = await server.start();
		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['entity'],
			allowedEntityCommands: [{ entity: 'Task', method: 'command', commandId: 'task.complete' }]
		});

		await expect(handle.invokeTool('entity', {
			entity: 'Task',
			method: 'command',
			commandId: 'task.complete',
			payload: {
				reason: 'done'
			}
		}, registration.sessionToken)).resolves.toEqual({
			accepted: true,
			outcome: 'entity-command',
			result: { ok: true, commandId: 'task.complete' }
		});
		expect(executed).toEqual([{
			entity: 'Task',
			method: 'command',
			commandId: 'task.complete',
			payload: {
				reason: 'done'
			}
		}]);
	});

	it('rejects entity commands outside the session allowlist', async () => {
		const server = new MissionMcpSignalServer({
			signalPort: new PolicyBoundAgentExecutionSignalPort({
				sink: {
					getSnapshot: async () => undefined,
					commit: async () => undefined
				}
			}),
			executeEntityCommand: async () => ({ ok: true })
		});
		const handle = await server.start();
		const registration = await server.registerExecution({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7',
			allowedTools: ['entity'],
			allowedEntityCommands: [{ entity: 'Task', method: 'command', commandId: 'task.complete' }]
		});

		await expect(handle.invokeTool('entity', {
			entity: 'Task',
			method: 'command',
			commandId: 'task.reopen',
			payload: {
				reason: 'reopen'
			}
		}, registration.sessionToken)).resolves.toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Entity command 'Task.command:task.reopen' is not allowed for this execution."
		});
	});
});
