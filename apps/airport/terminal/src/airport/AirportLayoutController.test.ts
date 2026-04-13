import { describe, expect, it } from 'vitest';
import {
	buildAirportBootstrapLayout,
	resolveAirportCompanionPaneDirection
} from './airportLayoutDefinition.js';

describe('buildAirportBootstrapLayout', () => {
	it('creates a root vertical airport shell with Tower on the left and Briefing Room on the right', () => {
		const layout = buildAirportBootstrapLayout({
			repoRoot: '/repo',
			towerCommand: 'tower-command',
			briefingRoomCommand: 'briefing-command',
			viewportColumns: 200
		});
		expect(layout).toContain('pane split_direction="vertical" {');
		expect(layout).toContain('pane name="TOWER" focus=true size="50%" borderless=true command="sh" cwd="/repo" {');
		expect(layout).toContain('pane name="BRIEFING ROOM" size="50%" command="sh" cwd="/repo" {');
		expect(layout).not.toContain('pane name="RUNWAY"');
	});

	it('stacks companion panes when the terminal is narrow', () => {
		expect(resolveAirportCompanionPaneDirection(79)).toBe('down');
		expect(resolveAirportCompanionPaneDirection(undefined)).toBe('down');
	});

	it('places companion panes side by side when the terminal is wide enough', () => {
		expect(resolveAirportCompanionPaneDirection(80)).toBe('right');
	});
});