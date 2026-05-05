import { describe, expect, it } from 'vitest';
import type { AgentSessionSnapshot } from '../AgentRuntimeTypes.js';
import { PolicyBoundAgentSessionSignalPort } from '../signals/AgentSessionSignalPort.js';
import type {
	AgentSessionObservation,
	AgentSessionSignalDecision
} from '../signals/AgentSessionSignal.js';
import { MissionMcpSignalServer } from './MissionMcpSignalServer.js';

function createSnapshot(
	overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot {
	return {
		runnerId: 'claude-code',
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
			runnerId: 'claude-code',
			sessionId: 'session-7'
		},
		startedAt: '2026-05-04T11:58:00.000Z',
		updatedAt: '2026-05-04T11:59:00.000Z',
		...overrides
	};
}

describe('MissionMcpSignalServer', () => {
	it('starts local-only, registers sessions, and routes valid calls through the signal policy port', async () => {
		const commits: {
			observation: AgentSessionObservation;
			decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>;
		}[] = [];
		const snapshots = new Map<string, AgentSessionSnapshot>([
			['session-7', createSnapshot()]
		]);
		const port = new PolicyBoundAgentSessionSignalPort({
			now: () => '2026-05-04T12:20:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentSessionId);
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
		const registration = await server.registerSession({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			allowedTools: [
				'mission_report_progress',
				'mission_append_session_note'
			]
		});
		const progressAcknowledgement = await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-1',
			summary: 'Halfway there.',
			detail: '3/6 checklist items are done.'
		});
		const noteAcknowledgement = await handle.invokeTool('mission_append_session_note', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-2',
			text: 'Need a follow-up after the next test run.'
		});
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
			agentSessionId: 'session-7',
			allowedTools: [
				'mission_report_progress',
				'mission_append_session_note'
			],
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
		expect(commits[0]?.observation.observationId).toBe('mcp:session-7:evt-1');
		expect(commits[1]?.decision.action).toBe('emit-message');
	});

	it('rejects invalid, mismatched, disallowed, duplicate, unknown-session, and stopped calls', async () => {
		const snapshots = new Map<string, AgentSessionSnapshot>([
			['session-7', createSnapshot()]
		]);
		const port = new PolicyBoundAgentSessionSignalPort({
			now: () => '2026-05-04T12:21:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentSessionId);
				},
				commit() {
					return undefined;
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();
		await server.registerSession({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			allowedTools: ['mission_report_progress']
		});

		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-invalid',
			summary: '   '
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Invalid payload for MCP tool 'mission_report_progress': summary: Too small: expected string to have >=1 characters"
		});
		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-4',
			agentSessionId: 'session-7',
			eventId: 'evt-mismatch',
			summary: 'Wrong task.'
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission MCP envelope task 'task-4' did not match registered task 'task-3'."
		});
		expect(await handle.invokeTool('mission_report_failure_claim', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-disallowed',
			reason: 'This tool should not be available.'
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission MCP tool 'mission_report_failure_claim' is not allowed for session 'session-7'."
		});
		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-1',
			summary: 'Accepted once.'
		})).toEqual({
			accepted: true,
			outcome: 'promoted',
			sessionStatus: 'running',
			waitingForInput: false
		});
		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-1',
			summary: 'Accepted twice?'
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission MCP event 'evt-1' was already processed for session 'session-7'."
		});

		await server.unregisterSession('session-7');

		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-2',
			summary: 'No longer registered.'
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Unknown Mission MCP session 'session-7'."
		});

		await server.stop();

		expect(await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-after-stop',
			summary: 'Server is down.'
		})).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: 'Mission MCP signal server is not running.'
		});
	});

	it('rejects ended sessions through the signal policy instead of mutating state directly', async () => {
		const snapshots = new Map<string, AgentSessionSnapshot>([
			['session-7', createSnapshot({
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:19:00.000Z'
			})]
		]);
		const commits: AgentSessionObservation[] = [];
		const port = new PolicyBoundAgentSessionSignalPort({
			now: () => '2026-05-04T12:22:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentSessionId);
				},
				commit(input) {
					commits.push(input.observation);
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();
		await server.registerSession({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			allowedTools: ['mission_report_progress']
		});

		const acknowledgement = await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-ended',
			summary: 'Trying to update a finished session.'
		});

		expect(acknowledgement).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission session 'session-7' already ended with status 'completed'."
		});
		expect(commits).toEqual([]);
	});

	it('keeps rejected policy calls out of event id dedupe and validates session registration input', async () => {
		const snapshots = new Map<string, AgentSessionSnapshot>([
			['session-7', createSnapshot({
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:19:00.000Z'
			})]
		]);
		const port = new PolicyBoundAgentSessionSignalPort({
			now: () => '2026-05-04T12:23:00.000Z',
			sink: {
				getSnapshot(scope) {
					return snapshots.get(scope.agentSessionId);
				},
				commit() {
					throw new Error('commit should not be called for rejected policy signals');
				}
			}
		});
		const server = new MissionMcpSignalServer({ signalPort: port });
		const handle = await server.start();

		await expect(server.registerSession({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: '   ',
			allowedTools: ['mission_report_progress']
		})).rejects.toThrow(
			"Invalid Mission MCP session registration: agentSessionId: Too small: expected string to have >=1 characters"
		);

		await server.registerSession({
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			allowedTools: ['mission_report_progress']
		});

		const firstAcknowledgement = await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-ended',
			summary: 'Trying again after completion.'
		});
		const retryAcknowledgement = await handle.invokeTool('mission_report_progress', {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentSessionId: 'session-7',
			eventId: 'evt-ended',
			summary: 'Trying again after completion.'
		});

		expect(firstAcknowledgement).toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission session 'session-7' already ended with status 'completed'."
		});
		expect(retryAcknowledgement).toEqual(firstAcknowledgement);
	});
});
