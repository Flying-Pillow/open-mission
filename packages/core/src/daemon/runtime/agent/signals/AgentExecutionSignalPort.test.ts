import { describe, expect, it } from 'vitest';
import type { AgentExecutionSnapshot } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { PolicyBoundAgentExecutionSignalPort } from './AgentExecutionSignalPort.js';
import type {
	AgentExecutionObservation,
	AgentExecutionSignalDecision,
	AgentExecutionSignalScope
} from './AgentExecutionSignal.js';

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

function createScope(
	overrides: Partial<AgentExecutionSignalScope> = {}
): AgentExecutionSignalScope {
	return {
		missionId: 'mission-31',
		taskId: 'task-3',
		agentExecutionId: 'session-7',
		...overrides
	};
}

describe('PolicyBoundAgentExecutionSignalPort', () => {
	it('promotes valid MCP signals through policy-bound acknowledgements', async () => {
		const commits: {
			observation: AgentExecutionObservation;
			decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>;
		}[] = [];
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:10:00.000Z',
			sink: {
				getSnapshot(scope: AgentExecutionSignalScope) {
					expect(scope).toEqual({
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					});
					return createSnapshot();
				},
				commit(input) {
					commits.push({
						observation: input.observation,
						decision: input.decision
					});
				}
			}
		});

		const acknowledgement = await port.reportSignal({
			scope: createScope(),
			eventId: 'evt-1',
			signal: {
				type: 'needs_input',
				question: 'Should I apply the patch now?',
				suggestedResponses: ['Yes', 'No'],
				source: 'mcp-validated',
				confidence: 'high'
			}
		});

		expect(acknowledgement).toEqual({
			accepted: true,
			outcome: 'promoted',
			sessionStatus: 'awaiting-input',
			waitingForInput: true
		});
		expect(commits).toHaveLength(1);
		expect(commits[0]).toEqual({
			observation: {
				observationId: 'mcp:session-7:evt-1',
				observedAt: '2026-05-04T12:10:00.000Z',
				route: {
					origin: 'mcp',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
				},
				signal: {
					type: 'needs_input',
					question: 'Should I apply the patch now?',
					suggestedResponses: ['Yes', 'No'],
					source: 'mcp-validated',
					confidence: 'high'
				}
			},
			decision: {
				action: 'update-session',
				eventType: 'execution.awaiting-input',
				snapshotPatch: {
					status: 'awaiting-input',
					attention: 'awaiting-operator',
					waitingForInput: true,
					progress: {
						state: 'waiting-input',
						summary: 'Should I apply the patch now?',
						detail: 'Suggested responses: Yes, No',
						updatedAt: '2026-05-04T12:10:00.000Z'
					}
				}
			}
		});
	});

	it('records message-only MCP signals without promoting session state', async () => {
		const commits: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>[] = [];
		const port = new PolicyBoundAgentExecutionSignalPort({
			now: () => '2026-05-04T12:11:00.000Z',
			sink: {
				getSnapshot() {
					return createSnapshot();
				},
				commit(input) {
					commits.push(input.decision);
				}
			}
		});

		const acknowledgement = await port.reportSignal({
			scope: createScope(),
			eventId: 'evt-2',
			signal: {
				type: 'message',
				channel: 'agent',
				text: 'Session note from Mission MCP.',
				source: 'mcp-validated',
				confidence: 'high'
			}
		});

		expect(acknowledgement).toEqual({
			accepted: true,
			outcome: 'recorded',
			sessionStatus: 'running',
			waitingForInput: false
		});
		expect(commits).toEqual([{
			action: 'emit-message',
			event: {
				type: 'execution.message',
				channel: 'agent',
				text: 'Session note from Mission MCP.',
				snapshot: createSnapshot()
			}
		}]);
	});

	it('rejects inactive sessions before MCP signals can reach policy promotion', async () => {
		const port = new PolicyBoundAgentExecutionSignalPort({
			sink: {
				getSnapshot() {
					return undefined;
				},
				commit() {
					throw new Error('commit should not be called for inactive sessions');
				}
			}
		});

		await expect(port.reportSignal({
			scope: createScope(),
			eventId: 'evt-1',
			signal: {
				type: 'progress',
				summary: 'Trying to report progress.',
				source: 'mcp-validated',
				confidence: 'high'
			}
		})).resolves.toEqual({
			accepted: false,
			outcome: 'rejected',
			reason: "Mission session 'session-7' is not active."
		});
	});
});
