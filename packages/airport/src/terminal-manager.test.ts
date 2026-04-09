import { describe, expect, it } from 'vitest';
import type { AirportState } from './types.js';
import { TerminalManagerSubstrateController } from './terminal-manager.js';

describe('TerminalManagerSubstrateController', () => {
	it('observes terminal-manager panes without applying focus effects', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'MISSION', is_plugin: false, is_focused: true },
						{ id: 2, title: 'AGENT SESSION', is_plugin: false, is_focused: false },
						{ id: 3, title: 'session-1', is_plugin: false, is_focused: false }
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
		const airportState = createAirportState({
			agentSession: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
		});

		const observed = await controller.observe(airportState);

		expect(observed.attached).toBe(true);
		expect(observed.panesByGate.agentSession).toMatchObject({
			paneId: 2,
			exists: true,
			expected: true,
			title: 'AGENT SESSION'
		});
		expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([]);
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
		expect(observed.panesByGate.dashboard).toMatchObject({ exists: false, expected: true, title: 'MISSION' });
	});
});

function createAirportState(overrides: Partial<AirportState['gates']> = {}): AirportState {
	return {
		airportId: 'airport:test',
		repositoryId: 'repo',
		repositoryRootPath: '/tmp/repo',
		gates: {
			dashboard: { targetKind: 'repository', targetId: 'repo', mode: 'control' },
			editor: { targetKind: 'repository', targetId: 'repo', mode: 'view' },
			agentSession: { targetKind: 'empty' },
			...overrides
		},
		focus: {},
		clients: {},
		substrate: {
			kind: 'terminal-manager',
			sessionName: 'mission-mission',
			layoutIntent: 'mission-control-v1',
			attached: false,
			panesByGate: {}
		}
	};
}