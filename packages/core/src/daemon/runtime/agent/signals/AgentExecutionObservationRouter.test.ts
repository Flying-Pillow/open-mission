import { describe, expect, it, vi } from 'vitest';
import { AgentExecutionObservationRouter } from './AgentExecutionObservationRouter.js';

const markerPrefix = '@task::';

const address = {
	agentExecutionId: 'session-7',
	scope: {
		kind: 'task' as const,
		missionId: 'mission-31',
		taskId: 'task-3'
	}
};

describe('AgentExecutionObservationRouter', () => {
	it('routes strict stdout markers through the agent-declared signal boundary', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			address,
			observedAt: '2026-05-04T12:00:00.000Z',
			markerPrefix,
			line: `${markerPrefix}${JSON.stringify({
				version: 1,
				agentExecutionId: address.agentExecutionId,
				eventId: 'evt-7',
				signal: {
					type: 'needs_input',
					question: 'Should I update the tests now?',
					choices: [
						{ kind: 'fixed', label: 'Yes', value: 'yes' },
						{ kind: 'fixed', label: 'No', value: 'no' },
						{ kind: 'manual', label: 'Other', placeholder: 'Describe the preferred next step.' }
					]
				}
			})}`
		});

		expect(observations).toEqual([{
			observationId: 'agent-declared-signal:evt-7',
			observedAt: '2026-05-04T12:00:00.000Z',
			claimedAddress: address,
			rawText: expect.stringContaining('"eventId":"evt-7"'),
			route: {
				origin: 'agent-declared-signal',
				address
			},
			signal: {
				type: 'needs_input',
				question: 'Should I update the tests now?',
				choices: [
					{ kind: 'fixed', label: 'Yes', value: 'yes' },
					{ kind: 'fixed', label: 'No', value: 'no' },
					{ kind: 'manual', label: 'Other', placeholder: 'Describe the preferred next step.' }
				],
				source: 'agent-declared',
				confidence: 'medium'
			}
		}]);
	});

	it('claims only execution identity and derives scope from the active route', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			address,
			observedAt: '2026-05-04T12:00:10.000Z',
			markerPrefix,
			line: `${markerPrefix}${JSON.stringify({
				version: 1,
				agentExecutionId: 'other-session',
				eventId: 'evt-wrong-session',
				signal: {
					type: 'progress',
					summary: 'This should be rejected by policy.'
				}
			})}`
		});

		expect(observations).toEqual([expect.objectContaining({
			claimedAddress: {
				agentExecutionId: 'other-session',
				scope: address.scope
			},
			route: {
				origin: 'agent-declared-signal',
				address
			}
		})]);
	});

	it('routes malformed stdout markers as agent-declared signal diagnostics', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			address,
			observedAt: '2026-05-04T12:00:30.000Z',
			markerPrefix,
			line: `${markerPrefix}{not-json}`
		});

		expect(observations).toEqual([{
			observationId: expect.stringMatching(/^agent-declared-signal:[a-f0-9]+:[0-9a-f-]+$/),
			observedAt: '2026-05-04T12:00:30.000Z',
			rawText: `${markerPrefix}{not-json}`,
			route: {
				origin: 'agent-declared-signal',
				address
			},
			signal: {
				type: 'diagnostic',
				code: 'agent-declared-signal-malformed',
				summary: 'Agent-declared signal marker did not contain valid JSON.',
				source: 'agent-declared',
				confidence: 'diagnostic'
			}
		}]);
	});

	it('records terminal heuristics as diagnostics when no strict marker is present', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stderr',
			address,
			observedAt: '2026-05-04T12:01:00.000Z',
			line: 'Waiting for input: choose yes or no to continue.'
		});

		expect(observations).toEqual([{
			observationId: 'terminal-output:heuristic-needs-input:waiting for input: choose yes or no to continue.',
			observedAt: '2026-05-04T12:01:00.000Z',
			rawText: 'Waiting for input: choose yes or no to continue.',
			route: {
				origin: 'terminal-output',
				address
			},
			signal: {
				type: 'diagnostic',
				code: 'terminal-heuristic',
				summary: 'Terminal output suggested the agent is waiting for operator input.',
				detail: 'Waiting for input: choose yes or no to continue.',
				payload: {
					heuristic: 'needs_input',
					channel: 'stderr'
				},
				source: 'terminal-heuristic',
				confidence: 'diagnostic'
			}
		}]);
	});

	it('logs active and matched terminal heuristic patterns for daemon debugging', () => {
		const logger = { debug: vi.fn() };
		const router = new AgentExecutionObservationRouter({ logger });

		router.route({
			kind: 'terminal-output',
			channel: 'stderr',
			address,
			observedAt: '2026-05-04T12:01:10.000Z',
			line: 'Cannot continue: missing token.'
		});

		expect(logger.debug).toHaveBeenCalledWith('Agent execution observation patterns active.', expect.objectContaining({
			markerPrefixes: expect.arrayContaining(['@task::'])
		}));
		expect(logger.debug).toHaveBeenCalledWith('Agent execution terminal heuristic pattern matched.', {
			heuristic: 'blocked',
			channel: 'stderr',
			pattern: '\\bcannot continue\\b',
			line: 'Cannot continue: missing token.'
		});
	});

	it('does not trust stderr marker-looking lines as agent-declared signals', () => {
		const router = new AgentExecutionObservationRouter();

		expect(router.route({
			kind: 'terminal-output',
			channel: 'stderr',
			address,
			observedAt: '2026-05-04T12:01:30.000Z',
			markerPrefix,
			line: `${markerPrefix}${JSON.stringify({
				version: 1,
				agentExecutionId: address.agentExecutionId,
				eventId: 'stderr-marker',
				signal: {
					type: 'progress',
					summary: 'This should stay untrusted.'
				}
			})}`
		})).toEqual([]);
	});

	it('assigns distinct observation ids when identical provider output repeats', () => {
		const router = new AgentExecutionObservationRouter();
		const firstObservation = router.route({
			kind: 'provider-output',
			address,
			observedAt: '2026-05-04T12:03:00.000Z',
			observation: {
				kind: 'message',
				channel: 'agent',
				text: 'Still working.'
			}
		});
		const secondObservation = router.route({
			kind: 'provider-output',
			address,
			observedAt: '2026-05-04T12:03:00.000Z',
			observation: {
				kind: 'message',
				channel: 'agent',
				text: 'Still working.'
			}
		});

		expect(firstObservation).toHaveLength(1);
		expect(secondObservation).toHaveLength(1);
		expect(firstObservation[0]?.observationId).toMatch(/^provider-output:[a-f0-9]+:[0-9a-f-]+$/);
		expect(firstObservation[0]?.observationId).not.toEqual(secondObservation[0]?.observationId);
		expect(firstObservation[0]?.signal).toEqual(secondObservation[0]?.signal);
	});

	it('ignores unmatched terminal lines instead of manufacturing diagnostics', () => {
		const router = new AgentExecutionObservationRouter();

		expect(router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			address,
			observedAt: '2026-05-04T12:03:00.000Z',
			line: 'npm notice using cached metadata'
		})).toEqual([]);
	});
});
