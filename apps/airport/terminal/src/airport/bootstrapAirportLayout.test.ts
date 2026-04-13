import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeMissionUserConfig } from '@flying-pillow/mission-core';
import {
	buildAirportBootstrapLayout,
	resolveAirportCompanionPaneDirection
} from './airportLayoutDefinition.js';
import {
	buildTerminalManagerConfig,
	parseTerminalManagerSessionName,
	parseTerminalManagerSessionSummary,
	resolveAirportRuntimeCommand
} from './bootstrapAirportLayout.js';

const originalXdgConfigHome = process.env['XDG_CONFIG_HOME'];

afterEach(async () => {
	const currentXdgConfigHome = process.env['XDG_CONFIG_HOME'];
	if (originalXdgConfigHome === undefined) {
		delete process.env['XDG_CONFIG_HOME'];
	} else {
		process.env['XDG_CONFIG_HOME'] = originalXdgConfigHome;
	}
	if (currentXdgConfigHome && currentXdgConfigHome !== originalXdgConfigHome) {
		await fs.rm(currentXdgConfigHome, { recursive: true, force: true });
	}
});

describe('bootstrapAirportLayout session reset parsing', () => {
	it('keeps briefing room as the only right-side pane in the initial layout', () => {
		const layout = buildAirportBootstrapLayout({
			repoRoot: '/repo',
			towerCommand: 'tower-command',
			briefingRoomCommand: 'briefing-command',
			viewportColumns: 200
		});
		expect(layout).toContain('pane split_direction="vertical" {');
		expect(layout).toContain('pane name="TOWER" focus=true size="50%" borderless=true command="sh" cwd="/repo" {');
		expect(layout).toContain(`args "-lc" "exec tower-command"`);
		expect(layout).toContain(`pane name="BRIEFING ROOM" size="50%" command="sh" cwd="/repo" {
				args "-lc" "exec briefing-command"
			}`);
		expect(layout).not.toContain('pane name="RUNWAY"');
	});

	it('uses a horizontal split for runway only when the viewport is wide enough', () => {
		expect(resolveAirportCompanionPaneDirection(79)).toBe('down');
		expect(resolveAirportCompanionPaneDirection(80)).toBe('right');
	});

	it('adds global ctrl-tab pane cycling to the airport terminal manager config', () => {
		const config = buildTerminalManagerConfig();
		expect(config).toContain('bind "Alt Right" "Alt l" { FocusNextPane; }');
		expect(config).toContain('bind "Alt Left" "Alt h" { FocusPreviousPane; }');
	});

	it('uses the configured Mission bun runtime when not already running under Bun', async () => {
		process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-airport-runtime-'));
		await writeMissionUserConfig({
			bunBinary: '/managed/mission/runtime/bun'
		});

		expect(resolveAirportRuntimeCommand('/repo/build/terminal.js')).toEqual([
			'/managed/mission/runtime/bun',
			'/repo/build/terminal.js'
		]);
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