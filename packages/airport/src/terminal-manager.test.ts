import { describe, expect, it } from 'vitest';
import { planAirportSubstrateEffects } from './effects.js';
import type { AirportState } from './types.js';
import { TerminalManagerSubstrateController } from './terminal-manager.js';

describe('TerminalManagerSubstrateController', () => {
	it('discovers fixed airport panes by title when terminal pane ids are unknown', async () => {
		const executor = (args: string[]) => {
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 0, title: 'TOWER', is_plugin: false, is_focused: false },
						{ id: 2, title: 'BRIEFING ROOM', is_plugin: false, is_focused: true }
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
			briefingRoom: { terminalPaneId: -1, expected: true, exists: false, title: 'BRIEFING ROOM' }
		});

		const observed = await controller.observe(airportState);

		expect(observed.panes.tower).toMatchObject({
			terminalPaneId: 0,
			exists: true,
			title: 'TOWER'
		});
		expect(observed.panes.briefingRoom).toMatchObject({
			terminalPaneId: 2,
			exists: true,
			title: 'BRIEFING ROOM'
		});
		expect(observed.observedFocusedTerminalPaneId).toBe(2);
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

	it('ignores missing-pane errors during focus sync', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('focus-pane-id')) {
				return Promise.reject(new Error('Pane with id Terminal(2) not found'));
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});
		const airportState = createAirportState();
		airportState.focus.intentPaneId = 'briefingRoom';
		airportState.substrate = {
			...airportState.substrate,
			panes: {
				briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' }
			}
		};

		await controller.applyEffects(planAirportSubstrateEffects(airportState));

		expect(calls).toContainEqual([
			'--session',
			'mission-mission',
			'action',
			'focus-pane-id',
			'terminal_2'
		]);
	});

	it('does not plan runway substrate effects from runway bindings', async () => {
		const airportState = createAirportState({
			runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
		});

		expect(planAirportSubstrateEffects(airportState)).toEqual([]);
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

	it('treats empty pane listings as no panes instead of crashing', async () => {
		const executor = (args: string[]) => {
			if (args.includes('list-panes')) {
				return Promise.resolve({ stdout: '', stderr: '' });
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});

		const observed = await controller.observe(createAirportState());

		expect(observed.attached).toBe(true);
		expect(observed.panes.tower).toMatchObject({ exists: false, expected: true, title: 'TOWER' });
	});

	it('treats non-json pane listings as no panes instead of crashing', async () => {
		const executor = (args: string[]) => {
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: 'mission-agent-c412ae18-c129-4fb8-a040-ca6e54944f7c [Created 16m 54s ago]\n',
					stderr: ''
				});
			}
			return Promise.resolve({ stdout: '', stderr: '' });
		};

		const controller = new TerminalManagerSubstrateController({
			sessionName: 'mission-mission',
			executor
		});

		const observed = await controller.observe(createAirportState());

		expect(observed.attached).toBe(true);
		expect(observed.panes.briefingRoom).toMatchObject({ exists: false, expected: true, title: 'BRIEFING ROOM' });
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