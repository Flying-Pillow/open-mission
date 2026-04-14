import { describe, expect, it } from 'vitest';
import {
	buildAirportBootstrapLayout,
	resolveAirportCompanionPaneDirection
} from './airportLayoutDefinition.js';

describe('buildAirportBootstrapLayout', () => {
	it('creates a direct tab split with tower on the left and companion panes on the right', () => {
		const layout = buildAirportBootstrapLayout({
			repoRoot: '/repo',
			towerCommand: 'tower-command',
			briefingRoomCommand: 'briefing-command',
			runwayCommand: 'runway-command',
			viewportColumns: 200
		});
		expect(layout).toContain('tab name="TOWER" split_direction="vertical" {');
		expect(layout).toContain('pane name="TOWER" focus=true size=100 borderless=true command="sh" cwd="/repo" {');
		expect(layout).toContain('pane split_direction="vertical" {');
		expect(layout).toContain('pane name="BRIEFING ROOM" size="50%" command="sh" cwd="/repo" {');
		expect(layout).toContain('pane name="RUNWAY" size="50%" command="sh" cwd="/repo" {');
	});

	it('stacks briefing room over runway when remaining width is narrow', () => {
		const layout = buildAirportBootstrapLayout({
			repoRoot: '/repo',
			towerCommand: 'tower-command',
			briefingRoomCommand: 'briefing-command',
			runwayCommand: 'runway-command',
			viewportColumns: 160
		});
		expect(layout).toContain('pane name="TOWER" focus=true size=80 borderless=true command="sh" cwd="/repo" {');
		expect(layout).toContain('pane split_direction="horizontal" {');
	});

	it('stacks companion panes when the terminal is narrow', () => {
		expect(resolveAirportCompanionPaneDirection(99)).toBe('down');
		expect(resolveAirportCompanionPaneDirection(undefined)).toBe('down');
	});

	it('places companion panes side by side when the terminal is wide enough', () => {
		expect(resolveAirportCompanionPaneDirection(100)).toBe('right');
	});
});