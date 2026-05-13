import { describe, expect, it } from 'vitest';
import { AgentExecutionObservationLedger, AgentExecutionObservationPolicy } from './AgentExecutionObservationPolicy.js';
import {
	MAX_AGENT_SIGNAL_MARKER_LENGTH,
	type AgentExecutionObservation,
	type AgentExecutionType
} from '../protocol/AgentExecutionProtocolTypes.js';

const markerPrefix = '@task::';

const address = {
	agentExecutionId: 'agent-execution-7',
	scope: {
		kind: 'task' as const,
		missionId: 'mission-31',
		taskId: 'task-3',
		stageId: 'implementation'
	}
};

function createExecution(): AgentExecutionType {
	return {
		agentId: 'claude-code',
		agentExecutionId: 'agent-execution-7',
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
		interactionPosture: 'structured-headless',
		reference: {
			agentId: 'claude-code',
			agentExecutionId: 'agent-execution-7'
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
			origin: 'agent-signal',
			address
		},
		signal: {
			type: 'progress',
			summary: 'Implemented the router.',
			source: 'agent-signal',
			confidence: 'medium'
		},
		...overrides
	};
}

describe('AgentExecutionObservationPolicy', () => {
	it('promotes valid medium-confidence progress and needs-input signals', () => {
		const policy = new AgentExecutionObservationPolicy();
		const progressDecision = policy.evaluate({
			execution: createExecution(),
			observation: createObservation()
		});
		const needsInputDecision = policy.evaluate({
			execution: createExecution(),
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
					source: 'agent-signal',
					confidence: 'medium'
				}
			})
		});

		expect(progressDecision).toEqual({
			action: 'update-execution',
			eventType: 'execution.updated',
			patch: {
				status: 'running',
				attention: 'autonomous',
				progress: {
					state: 'working',
					summary: 'Implemented the router.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
		expect(needsInputDecision).toEqual({
			action: 'update-execution',
			eventType: 'execution.updated',
			patch: {
				status: 'running',
				attention: 'awaiting-operator',
				currentInputRequestId: 'observation-2',
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

	it('promotes status phases into machine-readable AgentExecution state', () => {
		const policy = new AgentExecutionObservationPolicy();
		const initializingDecision = policy.evaluate({
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-status-1',
				signal: {
					type: 'status',
					phase: 'initializing',
					summary: 'Preparing the next turn.',
					source: 'agent-signal',
					confidence: 'medium'
				}
			})
		});
		const idleDecision = policy.evaluate({
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-status-2',
				signal: {
					type: 'status',
					phase: 'idle',
					summary: 'Ready for the next structured prompt.',
					source: 'agent-signal',
					confidence: 'medium'
				}
			})
		});

		expect(initializingDecision).toEqual({
			action: 'update-execution',
			eventType: 'execution.updated',
			patch: {
				status: 'starting',
				attention: 'none',
				progress: {
					state: 'initializing',
					summary: 'Preparing the next turn.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
		expect(idleDecision).toEqual({
			action: 'update-execution',
			eventType: 'execution.updated',
			patch: {
				status: 'running',
				attention: 'awaiting-operator',
				progress: {
					state: 'idle',
					summary: 'Ready for the next structured prompt.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
	});

	it('rejects spoofed addresses and duplicate observations', () => {
		const policy = new AgentExecutionObservationPolicy();
		const spoofed = policy.evaluate({
			execution: createExecution(),
			observation: createObservation({
				claimedAddress: {
					...address,
					agentExecutionId: 'someone-else'
				}
			})
		});
		const accepted = policy.evaluate({
			execution: createExecution(),
			observation: createObservation({ observationId: 'observation-2' })
		});
		const duplicate = policy.evaluate({
			execution: createExecution(),
			observation: createObservation({ observationId: 'observation-2' })
		});

		expect(spoofed).toEqual({
			action: 'reject',
			reason: 'Agent signal address did not match the active Agent execution.'
		});
		expect(accepted.action).toBe('update-execution');
		expect(duplicate).toEqual({
			action: 'reject',
			reason: "Observation 'observation-2' was already processed."
		});
	});

	it('uses an explicit observation ledger for idempotency', () => {
		const ledger = new AgentExecutionObservationLedger();
		const firstPolicy = new AgentExecutionObservationPolicy(ledger);
		const secondPolicy = new AgentExecutionObservationPolicy(ledger);

		expect(firstPolicy.evaluate({
			execution: createExecution(),
			observation: createObservation({ observationId: 'shared-observation' })
		}).action).toBe('update-execution');
		expect(secondPolicy.evaluate({
			execution: createExecution(),
			observation: createObservation({ observationId: 'shared-observation' })
		})).toEqual({
			action: 'reject',
			reason: "Observation 'shared-observation' was already processed."
		});
	});

	it('records terminal heuristics as diagnostics and keeps completion claims out of workflow truth', () => {
		const policy = new AgentExecutionObservationPolicy();
		const heuristic = policy.evaluate({
			execution: createExecution(),
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
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-4',
				signal: {
					type: 'completed_claim',
					summary: 'Task is complete.',
					source: 'agent-signal',
					confidence: 'medium'
				}
			})
		});

		expect(heuristic).toEqual({
			action: 'record-observation-only',
			reason: 'Diagnostic signals never mutate AgentExecution state.'
		});
		expect(completedClaim).toEqual({
			action: 'record-observation-only',
			reason: 'Completion claims stay observational unless the daemon is authoritative.'
		});
	});

	it('rejects route/source boundary mismatches and route address mismatches', () => {
		const policy = new AgentExecutionObservationPolicy();
		const mismatchedSource = policy.evaluate({
			execution: createExecution(),
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
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-6',
				route: {
					origin: 'agent-signal',
					address: {
						agentExecutionId: 'agent-execution-7',
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
			reason: "Observation origin 'agent-signal' requires signal source 'agent-signal'."
		});
		expect(mismatchedRouteAddress).toEqual({
			action: 'reject',
			reason: 'Observation route address did not match the active Agent execution.'
		});
	});

	it('rejects origin/type combinations that are outside the signal boundary', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
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

	it('rejects unaddressed agent-signal signals before they can promote AgentExecution state', () => {
		const policy = new AgentExecutionObservationPolicy();
		const observation = createObservation({
			observationId: 'observation-unscoped-marker'
		});
		delete observation.claimedAddress;

		expect(policy.evaluate({
			execution: createExecution(),
			observation
		})).toEqual({
			action: 'reject',
			reason: 'Agent signal observations must carry a claimed Agent execution address.'
		});
	});

	it('rejects terminal heuristics that spoof a higher confidence boundary', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
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

	it('rejects terminal output that tries to claim promotable AgentExecution state directly', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
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

	it('rejects agent-signal signals that spoof a stronger confidence than the boundary allows', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-10',
				signal: {
					type: 'progress',
					summary: 'Definitely complete.',
					source: 'agent-signal',
					confidence: 'high'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: "Observation origin 'agent-signal' requires signal confidence 'medium'."
		});
	});

	it('requires authoritative daemon claims', () => {
		const policy = new AgentExecutionObservationPolicy();
		const nonAuthoritativeDaemon = policy.evaluate({
			execution: createExecution(),
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
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-8',
				route: {
					origin: 'daemon',
					address
				},
				signal: {
					type: 'completed_claim',
					summary: 'Open Mission daemon confirmed completion.',
					source: 'daemon-authoritative',
					confidence: 'authoritative'
				}
			})
		})).toEqual({
			action: 'update-execution',
			eventType: 'execution.completed',
			patch: {
				status: 'completed',
				attention: 'none',
				waitingForInput: false,
				progress: {
					state: 'done',
					summary: 'Open Mission daemon confirmed completion.',
					updatedAt: '2026-05-04T12:00:00.000Z'
				},
				endedAt: '2026-05-04T12:00:00.000Z'
			}
		});
	});

	it('rejects oversized needs-input choice sets before promotion', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
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
					source: 'agent-signal',
					confidence: 'medium'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: 'needs-input choices exceeded the maximum supported size.'
		});
	});

	it('rejects oversized agent-signal signal claims before they can promote AgentExecution state', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: createExecution(),
			observation: createObservation({
				observationId: 'observation-oversized-marker',
				rawText: `${markerPrefix}${'x'.repeat(MAX_AGENT_SIGNAL_MARKER_LENGTH)}`
			})
		})).toEqual({
			action: 'reject',
			reason: 'Agent signal marker exceeded the maximum length.'
		});
	});

	it('rejects promotable claims after the AgentExecution has already ended', () => {
		const policy = new AgentExecutionObservationPolicy();

		expect(policy.evaluate({
			execution: {
				...createExecution(),
				status: 'completed',
				attention: 'none',
				endedAt: '2026-05-04T12:00:00.000Z'
			},
			observation: createObservation({
				observationId: 'observation-terminal-agent-execution-progress'
			})
		})).toEqual({
			action: 'reject',
			reason: "Agent execution 'agent-execution-7' already ended with status 'completed'."
		});
	});
});
