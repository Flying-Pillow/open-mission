import { describe, expect, it } from 'vitest';
import { AgentExecutionObservationPolicy } from './AgentExecutionObservationPolicy.js';
import {
	MAX_AGENT_DECLARED_SIGNAL_MARKER_LENGTH,
	type AgentExecutionObservation,
	type AgentExecutionSnapshot
} from './AgentExecutionProtocolTypes.js';

const markerPrefix = '@task::';

const address = {
	agentExecutionId: 'session-7',
	scope: {
		kind: 'task' as const,
		missionId: 'mission-31',
		taskId: 'task-3',
		stageId: 'implementation'
	}
};

function createSnapshot(): AgentExecutionSnapshot {
	return {
		agentId: 'claude-code',
		sessionId: 'session-7',
		scope: {
			kind: 'task',
			missionId: 'mission-31',
			taskId: 'task-3',
			stageId: 'implementation'
		},
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
		updatedAt: '2026-05-04T11:59:00.000Z'
	};
}

function createObservation(overrides: Partial<AgentExecutionObservation> = {}): AgentExecutionObservation {
	return {
		observationId: 'observation-1',
		observedAt: '2026-05-04T12:00:00.000Z',
		claimedAddress: address,
		route: {
			origin: 'agent-declared-signal',
			address
		},
		signal: {
			type: 'progress',
			summary: 'Implemented the router.',
			source: 'agent-declared',
			confidence: 'medium'
		},
		...overrides
	};
}

describe('AgentExecutionObservationPolicy', () => {
	it('promotes valid medium-confidence progress and needs-input signals', () => {
		const policy = new AgentExecutionObservationPolicy();
		const progressDecision = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation()
		});
		const needsInputDecision = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-2',
				signal: {
					type: 'needs_input',
					question: 'Should I run the verification slice?',
					choices: [
						{ kind: 'fixed', label: 'Yes', value: 'yes' },
						{ kind: 'fixed', label: 'No', value: 'no' },
						{ kind: 'manual', label: 'Other', placeholder: 'Describe the verification command.' }
					],
					source: 'agent-declared',
					confidence: 'medium'
				}
			})
		});

		expect(progressDecision).toEqual({
			action: 'update-session',
			eventType: 'execution.updated',
			snapshotPatch: {
				status: 'running',
				attention: 'autonomous',
				waitingForInput: false,
				progress: {
					state: 'working',
					summary: 'Implemented the router.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
		expect(needsInputDecision).toEqual({
			action: 'update-session',
			eventType: 'execution.awaiting-input',
			snapshotPatch: {
				status: 'awaiting-input',
				attention: 'awaiting-operator',
				waitingForInput: true,
				progress: {
					state: 'waiting-input',
					summary: 'Should I run the verification slice?',
					detail: 'Choices: Yes=yes, No=no, Other=manual (Describe the verification command.)',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
	});

	it('rejects spoofed addresses and duplicate observations', () => {
		const policy = new AgentExecutionObservationPolicy();
		const spoofed = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				claimedAddress: {
					...address,
					agentExecutionId: 'someone-else'
				}
			})
		});
		const accepted = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({ observationId: 'observation-2' })
		});
		const duplicate = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({ observationId: 'observation-2' })
		});

		expect(spoofed).toEqual({
			action: 'reject',
			reason: 'Agent-declared signal address did not match the active Agent execution.'
		});
		expect(accepted.action).toBe('update-session');
		expect(duplicate).toEqual({
			action: 'reject',
			reason: "Observation 'observation-2' was already processed."
		});
	});

	it('records terminal heuristics as diagnostics and keeps completion claims out of workflow truth', () => {
		const policy = new AgentExecutionObservationPolicy();
		const heuristic = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-3',
				route: {
					origin: 'terminal-output',
					address
				},
				signal: {
					type: 'diagnostic',
					code: 'terminal-heuristic',
					summary: 'Terminal output suggested the agent is making progress.',
					detail: 'Maybe done?',
					payload: {
						heuristic: 'progress',
						channel: 'stdout'
					},
					source: 'terminal-heuristic',
					confidence: 'diagnostic'
				}
			})
		});
		const completedClaim = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-4',
				signal: {
					type: 'completed_claim',
					summary: 'Task is complete.',
					source: 'agent-declared',
					confidence: 'medium'
				}
			})
		});

		expect(heuristic).toEqual({
			action: 'record-observation-only',
			reason: 'Diagnostic signals never mutate session state.'
		});
		expect(completedClaim).toEqual({
			action: 'record-observation-only',
			reason: 'Completion claims stay observational unless the daemon is authoritative.'
		});
	});

	it('rejects route/source boundary mismatches and route address mismatches', () => {
		const policy = new AgentExecutionObservationPolicy();
		const mismatchedSource = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-5',
				signal: {
					type: 'progress',
					summary: 'Pretending to be provider output.',
					source: 'provider-structured',
					confidence: 'high'
				}
			})
		});
		const mismatchedRouteAddress = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-6',
				route: {
					origin: 'agent-declared-signal',
					address: {
						agentExecutionId: 'session-7',
						scope: {
							kind: 'task',
							missionId: 'mission-31',
							taskId: 'task-99',
							stageId: 'implementation'
						}
					}
				}
			})
		});

		expect(mismatchedSource).toEqual({
			action: 'reject',
			reason: "Observation origin 'agent-declared-signal' requires signal source 'agent-declared'."
		});
		expect(mismatchedRouteAddress).toEqual({
			action: 'reject',
			reason: 'Observation route address did not match the active Agent execution.'
		});
	});

	it('rejects origin/type combinations that are outside the signal boundary', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-provider-progress',
				route: {
					origin: 'provider-output',
					address
				},
				signal: {
					type: 'progress',
					summary: 'Provider says this is done.',
					source: 'provider-structured',
					confidence: 'high'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: "Observation origin 'provider-output' does not allow signal type 'progress'."
		});
	});

	it('rejects unaddressed agent-declared signals before they can promote session state', () => {
		const policy = new AgentExecutionObservationPolicy();
		const observation = createObservation({
			observationId: 'observation-unscoped-marker'
		});
		delete observation.claimedAddress;

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation
		})).toEqual({
			action: 'reject',
			reason: 'Agent-declared signal observations must carry a claimed Agent execution address.'
		});
	});

	it('rejects terminal heuristics that spoof a higher confidence boundary', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-7',
				route: {
					origin: 'terminal-output',
					address
				},
				signal: {
					type: 'diagnostic',
					code: 'terminal-heuristic',
					summary: 'Terminal output suggested the agent is waiting for operator input.',
					source: 'terminal-heuristic',
					confidence: 'high'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: "Observation origin 'terminal-output' requires signal confidence 'diagnostic'."
		});
	});

	it('rejects terminal output that tries to claim promotable session state directly', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-terminal-progress',
				route: {
					origin: 'terminal-output',
					address
				},
				signal: {
					type: 'progress',
					summary: 'Completed 3/4 subtasks.',
					source: 'terminal-heuristic',
					confidence: 'low'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: "Observation origin 'terminal-output' does not allow signal type 'progress'."
		});
	});

	it('rejects agent-declared signals that spoof a stronger confidence than the boundary allows', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-10',
				signal: {
					type: 'progress',
					summary: 'Definitely complete.',
					source: 'agent-declared',
					confidence: 'high'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: "Observation origin 'agent-declared-signal' requires signal confidence 'medium'."
		});
	});

	it('requires authoritative daemon claims', () => {
		const policy = new AgentExecutionObservationPolicy();
		const nonAuthoritativeDaemon = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-daemon-high',
				route: {
					origin: 'daemon',
					address
				},
				signal: {
					type: 'failed_claim',
					reason: 'Daemon suspects failure.',
					source: 'daemon-authoritative',
					confidence: 'high'
				}
			})
		});

		expect(nonAuthoritativeDaemon).toEqual({
			action: 'reject',
			reason: "Observation origin 'daemon' requires signal confidence 'authoritative'."
		});
	});

	it('promotes daemon-authoritative completion claims only', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-8',
				route: {
					origin: 'daemon',
					address
				},
				signal: {
					type: 'completed_claim',
					summary: 'Mission daemon confirmed completion.',
					source: 'daemon-authoritative',
					confidence: 'authoritative'
				}
			})
		})).toEqual({
			action: 'update-session',
			eventType: 'execution.completed',
			snapshotPatch: {
				status: 'completed',
				attention: 'none',
				waitingForInput: false,
				progress: {
					state: 'done',
					summary: 'Mission daemon confirmed completion.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				},
				endedAt: '2026-05-04T12:00:00.000Z'
			}
		});
	});

	it('rejects oversized needs-input choice sets before promotion', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-9',
				signal: {
					type: 'needs_input',
					question: 'Choose a path.',
					choices: [
						{ kind: 'fixed', label: '1', value: '1' },
						{ kind: 'fixed', label: '2', value: '2' },
						{ kind: 'fixed', label: '3', value: '3' },
						{ kind: 'fixed', label: '4', value: '4' },
						{ kind: 'fixed', label: '5', value: '5' },
						{ kind: 'fixed', label: '6', value: '6' },
						{ kind: 'manual', label: 'Other' }
					],
					source: 'agent-declared',
					confidence: 'medium'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: 'needs-input choices exceeded the maximum supported size.'
		});
	});

	it('rejects oversized agent-declared signal claims before they can promote session state', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-oversized-marker',
				rawText: `${markerPrefix}${'x'.repeat(MAX_AGENT_DECLARED_SIGNAL_MARKER_LENGTH)}`
			})
		})).toEqual({
			action: 'reject',
			reason: 'Agent-declared signal marker exceeded the maximum length.'
		});
	});

	it('rejects promotable claims after the session has already ended', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			snapshot: {
				...createSnapshot(),
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:00:00.000Z'
			},
			observation: createObservation({
				observationId: 'observation-terminal-session-progress'
			})
		})).toEqual({
			action: 'reject',
			reason: "Agent execution 'session-7' already ended with status 'completed'."
		});
	});
});
