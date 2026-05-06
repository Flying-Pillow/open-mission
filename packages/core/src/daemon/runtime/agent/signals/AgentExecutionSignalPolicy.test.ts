import { describe, expect, it } from 'vitest';
import type { AgentExecutionSnapshot } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { AgentExecutionSignalPolicy } from './AgentExecutionSignalPolicy.js';
import { MAX_MISSION_PROTOCOL_MARKER_LENGTH } from './AgentExecutionSignal.js';
import {
	MISSION_PROTOCOL_MARKER_PREFIX
} from './MissionProtocolMarkerParser.js';
import type { AgentExecutionObservation } from './AgentExecutionSignal.js';

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
		claimedScope: {
			missionId: 'mission-31',
			taskId: 'task-3',
			agentExecutionId: 'session-7'
		},
		route: {
			origin: 'protocol-marker',
			scope: {
				missionId: 'mission-31',
				taskId: 'task-3',
				agentExecutionId: 'session-7'
			}
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

describe('AgentExecutionSignalPolicy', () => {
	it('promotes valid medium-confidence progress and needs-input signals', () => {
		const policy = new AgentExecutionSignalPolicy();
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
					suggestedResponses: ['Yes', 'No'],
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
					detail: 'Suggested responses: Yes, No',
					updatedAt: '2026-05-04T12:00:00.000Z'
				}
			}
		});
	});

	it('rejects spoofed scopes and duplicate observations', () => {
		const policy = new AgentExecutionSignalPolicy();
		const spoofed = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				claimedScope: {
					missionId: 'mission-31',
					taskId: 'task-3',
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
			reason: 'Signal scope did not match the active Mission execution.'
		});
		expect(accepted.action).toBe('update-session');
		expect(duplicate).toEqual({
			action: 'reject',
			reason: "Observation 'observation-2' was already processed."
		});
	});

	it('records terminal heuristics as diagnostics and keeps completion claims out of workflow truth', () => {
		const policy = new AgentExecutionSignalPolicy();
		const heuristic = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-3',
				route: {
					origin: 'terminal-output',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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

	it('rejects route/source boundary mismatches and route scope mismatches', () => {
		const policy = new AgentExecutionSignalPolicy();
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
		const mismatchedRouteScope = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-6',
				route: {
					origin: 'protocol-marker',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-99',
						agentExecutionId: 'session-7'
					}
				}
			})
		});

		expect(mismatchedSource).toEqual({
			action: 'reject',
			reason: "Observation origin 'protocol-marker' requires signal source 'agent-declared'."
		});
		expect(mismatchedRouteScope).toEqual({
			action: 'reject',
			reason: 'Observation route scope did not match the active Mission execution.'
		});
	});

	it('rejects origin/type combinations that are outside the Mission signal boundary', () => {
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-provider-progress',
				route: {
					origin: 'provider-output',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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

	it('rejects unscoped strict protocol markers before they can promote session state', () => {
		const policy = new AgentExecutionSignalPolicy();
		const observation = createObservation({
			observationId: 'observation-unscoped-marker'
		});
		delete observation.claimedScope;

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation
		})).toEqual({
			action: 'reject',
			reason: 'Protocol-marker observations must carry a claimed Mission scope.'
		});
	});

	it('rejects terminal heuristics that spoof a higher confidence boundary', () => {
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-7',
				route: {
					origin: 'terminal-output',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-terminal-progress',
				route: {
					origin: 'terminal-output',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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

	it('rejects protocol markers that spoof a stronger confidence than Mission allows', () => {
		const policy = new AgentExecutionSignalPolicy();

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
			reason: "Observation origin 'protocol-marker' requires signal confidence 'medium'."
		});
	});

	it('requires authoritative daemon claims', () => {
		const policy = new AgentExecutionSignalPolicy();
		const nonAuthoritativeDaemon = policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-daemon-high',
				route: {
					origin: 'daemon',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-8',
				route: {
					origin: 'daemon',
					scope: {
						missionId: 'mission-31',
						taskId: 'task-3',
						agentExecutionId: 'session-7'
					}
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

	it('rejects oversized suggested response sets before promotion', () => {
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-9',
				signal: {
					type: 'needs_input',
					question: 'Choose a path.',
					suggestedResponses: ['1', '2', '3', '4', '5', '6', '7'],
					source: 'agent-declared',
					confidence: 'medium'
				}
			})
		})).toEqual({
			action: 'reject',
			reason: 'suggested responses exceeded the maximum supported size.'
		});
	});

	it('rejects oversized protocol-marker claims before they can promote session state', () => {
		const policy = new AgentExecutionSignalPolicy();

		expect(policy.evaluate({
			snapshot: createSnapshot(),
			observation: createObservation({
				observationId: 'observation-oversized-marker',
				rawText: `${MISSION_PROTOCOL_MARKER_PREFIX}${'x'.repeat(MAX_MISSION_PROTOCOL_MARKER_LENGTH)}`
			})
		})).toEqual({
			action: 'reject',
			reason: 'Mission protocol marker exceeded the maximum length.'
		});
	});

	it('rejects promotable claims after the session has already ended', () => {
		const policy = new AgentExecutionSignalPolicy();

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
