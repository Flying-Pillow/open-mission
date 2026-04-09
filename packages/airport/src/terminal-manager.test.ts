import { describe, expect, it } from 'vitest';
import type { AirportState } from './types.js';
import { TerminalManagerSubstrateController } from './terminal-manager.js';

describe('TerminalManagerSubstrateController', () => {
	it('does not refocus the agent session target again when the binding is unchanged', async () => {
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

		await controller.reconcile(airportState);
		await controller.reconcile(airportState);

		expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([
			['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_3'],
			['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_1']
		]);
	});

	it('does not focus the agent session host pane while the agent session gate is idle', async () => {
		const calls: string[][] = [];
		const executor = (args: string[]) => {
			calls.push(args);
			if (args.includes('list-panes')) {
				return Promise.resolve({
					stdout: JSON.stringify([
						{ id: 1, title: 'MISSION', is_plugin: false, is_focused: true },
						{ id: 2, title: 'AGENT SESSION', is_plugin: false, is_focused: false }
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

		await controller.reconcile(createAirportState());

		expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([]);
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