import { describe, expect, it } from 'vitest';
import { planAirportSubstrateEffects } from './effects.js';
import type { AirportState } from './types.js';
import { TerminalManagerSubstrateController } from './terminal-manager.js';

describe('TerminalManagerSubstrateController', () => {
	it('discovers airport panes by title when terminal pane ids are unknown', async () => {
		const executor = (args: string[]) => {
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 0, title: 'TOWER', is_plugin: false, is_focused: false },
						{ id: 1, title: 'RUNWAY', is_plugin: false, is_focused: true },
						{ id: 2, title: 'BRIEFING ROOM', is_plugin: false, is_focused: false }
					]),
					stderr: ''
				});
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const airportState = createAirportState({}, {
			tower: { terminalPaneId: -1, expected: true, exists: false, title: 'TOWER' },
			runway: { terminalPaneId: -1, expected: true, exists: false, title: 'RUNWAY' },
			briefingRoom: { terminalPaneId: -1, expected: true, exists: false, title: 'BRIEFING ROOM' }
		});

		const observed = await controller.observe(airportState);

		expect(observed.panes.runway).toMatchObject({
			terminalPaneId: 1,
			exists: true,
			title: 'RUNWAY'
		});
		expect(observed.observedFocusedTerminalPaneId).toBe(1);
	});

	it('observes terminal-manager panes without applying focus effects', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'mission-dashboard', is_plugin: false, is_focused: true },
						{ id: 2, title: 'session-1', is_plugin: false, is_focused: false },
						{ id: 3, title: 'editor-pane', is_plugin: false, is_focused: false }
					]),
					stderr: ''
				});
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const airportState = createAirportState(
			{
				runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
			},
			{
				tower: { terminalPaneId: 1, expected: true, exists: true, title: 'TOWER' },
				runway: { terminalPaneId: 2, expected: true, exists: true, title: 'RUNWAY' },
				briefingRoom: { terminalPaneId: 3, expected: true, exists: true, title: 'BRIEFING ROOM' }
			}
		);

		const observed = await controller.observe(airportState);

		expect(observed.attached).toBe(true);
		expect(observed.panes.runway).toMatchObject({
			terminalPaneId: 2,
			exists: true,
			expected: true,
			title: 'session-1'
		});
		expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([]);
	});

	it('applies planned focus effects through terminal-manager', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'mission-dashboard', is_plugin: false, is_focused: true },
						{ id: 2, title: 'editor-pane', is_plugin: false, is_focused: false },
						{ id: 3, title: 'session-pane', is_plugin: false, is_focused: false }
					]),
					stderr: ''
				});
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const observed = await controller.observe(createAirportState({
			runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
		}, {
			tower: { terminalPaneId: 1, expected: true, exists: true, title: 'TOWER' },
			briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' },
			runway: { terminalPaneId: 3, expected: true, exists: true, title: 'RUNWAY' }
		}));
		const airportState = createAirportState();
		airportState.focus.intentPaneId = 'briefingRoom';
		airportState.substrate = observed;

		await controller.applyEffects(planAirportSubstrateEffects(airportState));

		expect(calls).toContainEqual([
			'--session',
			'mission-mission',
			'action',
			'focus-pane-id',
			'terminal_2'
		]);
	});

	it('creates the runway pane when a session binding appears', async () => {
		const calls: string[][] = [];
		let includeAgentPane = false;
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'TOWER', is_plugin: false, is_focused: true },
						{ id: 2, title: 'BRIEFING ROOM', is_plugin: false, is_focused: false },
						...(includeAgentPane ? [{ id: 3, title: 'RUNWAY', is_plugin: false, is_focused: false }] : [])
					]),
					stderr: ''
				});
			}
			if (args.includes('new-pane')) {
				includeAgentPane = true;
				return Promise.resolve({ stdout: '', stderr: '' });
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const state = createAirportState({
			runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
		});

		await controller.observe(state);
		await controller.applyEffects(planAirportSubstrateEffects(state));

		expect(calls.some((args) => args.includes('new-pane') && args.includes('--in-place'))).toBe(true);
	});

	it('removes the runway pane when no session is selected', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'TOWER', is_plugin: false, is_focused: false },
						{ id: 2, title: 'BRIEFING ROOM', is_plugin: false, is_focused: true },
						{ id: 3, title: 'RUNWAY', is_plugin: false, is_focused: false }
					]),
					stderr: ''
				});
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const state = createAirportState({}, {
			tower: { terminalPaneId: 1, expected: true, exists: true, title: 'TOWER' },
			briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' },
			runway: { terminalPaneId: 3, expected: false, exists: true, title: 'RUNWAY' }
		});

		await controller.observe(state);
		await controller.applyEffects(planAirportSubstrateEffects(state));

		expect(calls).toContainEqual(['--session', 'mission-mission', 'action', 'close-pane']);
	});

	it('reports a detached substrate when pane listing fails', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.reject(new Error('terminal-manager unavailable'));
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});

		const observed = await controller.observe(createAirportState());

		expect(observed.attached).toBe(false);
		expect(observed.panes.tower).toMatchObject({ exists: false, expected: true, title: 'TOWER' });
	});
});

function createAirportState(overrides: Partial<AirportState['panes']> = {}, panes: AirportState['substrate']['panes'] = {}): AirportState {
	return {
		airportId: 'airport:test',
		repositoryId: 'repo',
		repositoryRootPath: '/tmp/repo',
		panes: {
			tower: { targetKind: 'repository', targetId: 'repo', mode: 'control' },
			briefingRoom: { targetKind: 'repository', targetId: 'repo', mode: 'view' },
			runway: { targetKind: 'empty' },
			...overrides
		},
		focus: {},
		clients: {},
		substrate: {
			kind: 'terminal-manager',
			sessionName: 'mission-mission',
			layoutIntent: 'mission-control-v1',
			attached: false,
			panes
		}
	};
}