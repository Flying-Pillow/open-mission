import { describe, expect, it } from 'vitest';
import {
	MISSION_PROTOCOL_MARKER_PREFIX,
	MissionProtocolMarkerParser
} from './MissionProtocolMarkerParser.js';
import { MAX_MISSION_PROTOCOL_MARKER_LENGTH } from './AgentExecutionSignal.js';

describe('MissionProtocolMarkerParser', () => {
	it('parses strict Mission progress markers into agent-declared signals', () => {
		const parser = new MissionProtocolMarkerParser();
		const observations = parser.parse(
			`${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
				version: 1,
				missionId: 'mission-31',
				taskId: 'task-3',
				agentExecutionId: 'session-7',
				eventId: 'evt-1',
				signal: {
					type: 'progress',
					summary: 'Implemented signal boundary.',
					detail: 'Policy and router are in place.'
				}
			})}`
		);

		expect(observations).toEqual([{
			dedupeKey: 'evt-1',
			claimedScope: {
				missionId: 'mission-31',
				taskId: 'task-3',
				agentExecutionId: 'session-7'
			},
			rawText: expect.stringContaining('"eventId":"evt-1"'),
			signal: {
				type: 'progress',
				summary: 'Implemented signal boundary.',
				detail: 'Policy and router are in place.',
				source: 'agent-declared',
				confidence: 'medium'
			}
		}]);
	});

	it('accepts strict Mission message markers for any supported session message channel', () => {
		const parser = new MissionProtocolMarkerParser();
		const observations = parser.parse(
			`${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
				version: 1,
				missionId: 'mission-31',
				taskId: 'task-3',
				agentExecutionId: 'session-7',
				eventId: 'evt-message-1',
				signal: {
					type: 'message',
					channel: 'stdout',
					text: 'Structured agent output.'
				}
			})}`
		);

		expect(observations).toEqual([{
			dedupeKey: 'evt-message-1',
			claimedScope: {
				missionId: 'mission-31',
				taskId: 'task-3',
				agentExecutionId: 'session-7'
			},
			rawText: expect.stringContaining('"channel":"stdout"'),
			signal: {
				type: 'message',
				channel: 'stdout',
				text: 'Structured agent output.',
				source: 'agent-declared',
				confidence: 'medium'
			}
		}]);
	});

	it('records malformed markers as diagnostics', () => {
		const parser = new MissionProtocolMarkerParser();
		const rawLine = `${MISSION_PROTOCOL_MARKER_PREFIX}{not-json}`;
		const observations = parser.parse(rawLine);

		expect(observations).toEqual([{
			rawText: rawLine,
			signal: {
				type: 'diagnostic',
				code: 'protocol-marker-malformed',
				summary: 'Mission protocol marker did not contain valid JSON.',
				source: 'agent-declared',
				confidence: 'diagnostic'
			}
		}]);
	});

	it('records oversized markers as diagnostics only', () => {
		const parser = new MissionProtocolMarkerParser();
		const rawLine = `${MISSION_PROTOCOL_MARKER_PREFIX}${'x'.repeat(MAX_MISSION_PROTOCOL_MARKER_LENGTH)}`;

		expect(parser.parse(rawLine)).toEqual([{
			rawText: rawLine,
			signal: {
				type: 'diagnostic',
				code: 'protocol-marker-oversized',
				summary: 'Mission protocol marker exceeded the maximum length.',
				source: 'agent-declared',
				confidence: 'diagnostic'
			}
		}]);
	});

	it('requires the strict marker prefix at the start of the line', () => {
		const parser = new MissionProtocolMarkerParser();

		expect(parser.parse(` ${MISSION_PROTOCOL_MARKER_PREFIX}{}`)).toEqual([]);
	});
});
