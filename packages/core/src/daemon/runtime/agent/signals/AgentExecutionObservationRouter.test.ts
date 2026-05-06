import { describe, expect, it } from 'vitest';
import { AgentExecutionObservationRouter } from './AgentExecutionObservationRouter.js';
import { MISSION_PROTOCOL_MARKER_PREFIX } from './MissionProtocolMarkerParser.js';

const scope = {
	missionId: 'mission-31',
	taskId: 'task-3',
	agentExecutionId: 'session-7'
};

describe('AgentExecutionObservationRouter', () => {
	it('routes strict stdout markers through the protocol-marker boundary', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			scope,
			observedAt: '2026-05-04T12:00:00.000Z',
			line: `${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
				version: 1,
				missionId: scope.missionId,
				taskId: scope.taskId,
				agentExecutionId: scope.agentExecutionId,
				eventId: 'evt-7',
				signal: {
					type: 'needs_input',
					question: 'Should I update the tests now?',
					suggestedResponses: ['Yes', 'No']
				}
			})}`
		});

		expect(observations).toEqual([{
			observationId: 'protocol-marker:evt-7',
			observedAt: '2026-05-04T12:00:00.000Z',
			claimedScope: scope,
			rawText: expect.stringContaining('"eventId":"evt-7"'),
			route: {
				origin: 'protocol-marker',
				scope
			},
			signal: {
				type: 'needs_input',
				question: 'Should I update the tests now?',
				suggestedResponses: ['Yes', 'No'],
				source: 'agent-declared',
				confidence: 'medium'
			}
		}]);
	});

	it('routes malformed stdout markers as protocol-marker diagnostics', () => {
		const router = new AgentExecutionObservationRouter();
		const observations = router.route({
			kind: 'terminal-output',
			channel: 'stdout',
			scope,
			observedAt: '2026-05-04T12:00:30.000Z',
			line: `${MISSION_PROTOCOL_MARKER_PREFIX}{not-json}`
		});

		expect(observations).toEqual([{
			observationId: expect.stringMatching(/^protocol-marker:[a-f0-9]+:[0-9a-f-]+$/),
			observedAt: '2026-05-04T12:00:30.000Z',
			rawText: `${MISSION_PROTOCOL_MARKER_PREFIX}{not-json}`,
			route: {
				origin: 'protocol-marker',
				scope
			},
			signal: {
				type: 'diagnostic',
				code: 'protocol-marker-malformed',
				summary: 'Mission protocol marker did not contain valid JSON.',
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
			scope,
			observedAt: '2026-05-04T12:01:00.000Z',
			line: 'Waiting for input: choose yes or no to continue.'
		});

		expect(observations).toEqual([{
			observationId: 'terminal-output:heuristic-needs-input:waiting for input: choose yes or no to continue.',
			observedAt: '2026-05-04T12:01:00.000Z',
			rawText: 'Waiting for input: choose yes or no to continue.',
			route: {
				origin: 'terminal-output',
				scope
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

	it('does not trust stderr marker-looking lines as protocol markers', () => {
		const router = new AgentExecutionObservationRouter();

		expect(router.route({
			kind: 'terminal-output',
			channel: 'stderr',
			scope,
			observedAt: '2026-05-04T12:01:30.000Z',
			line: `${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
				version: 1,
				missionId: scope.missionId,
				taskId: scope.taskId,
				agentExecutionId: scope.agentExecutionId,
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
			scope,
			observedAt: '2026-05-04T12:03:00.000Z',
			observation: {
				kind: 'message',
				channel: 'agent',
				text: 'Still working.'
			}
		});
		const secondObservation = router.route({
			kind: 'provider-output',
			scope,
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
			scope,
			observedAt: '2026-05-04T12:03:00.000Z',
			line: 'npm notice using cached metadata'
		})).toEqual([]);
	});
});
