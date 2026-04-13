import { describe, expect, it } from 'vitest';
import {
	buildAirportLayout,
	parseTerminalManagerSessionName,
	parseTerminalManagerSessionSummary
} from './bootstrapAirportLayout.js';

describe('bootstrapAirportLayout session reset parsing', () => {
	it('keeps briefing room as the only right-side pane in the initial layout', () => {
		expect(
			buildAirportLayout({
				repoRoot: '/repo',
				towerCommand: 'tower-command',
				briefingRoomCommand: 'briefing-command'
			})
		).toContain(`pane name="BRIEFING ROOM" size="50%" command="sh" cwd="/repo" {
				args "-lc" "exec briefing-command"
			}`);
	});

	it('strips created and exited suffixes from dead sessions', () => {
		expect(
			parseTerminalManagerSessionName(
				'flying-pillow-mission | AIRPORT [Created 58s ago] (EXITED - attach to resurrect)'
			)
		).toBe('flying-pillow-mission | AIRPORT');
	});

	it('classifies exited sessions after parsing the plain session name', () => {
		expect(
			parseTerminalManagerSessionSummary(
				'flying-pillow-mission | AIRPORT [Created 58s ago] (EXITED - attach to resurrect)'
			)
		).toEqual({
			name: 'flying-pillow-mission | AIRPORT',
			state: 'exited'
		});
	});
});