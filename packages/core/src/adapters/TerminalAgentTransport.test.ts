import { describe, expect, it } from 'vitest';
import { TerminalAgentTransport, type TerminalAgentTransportOptions } from './TerminalAgentTransport.js';

describe('TerminalAgentTransport', () => {
	it('opens a shared-session terminal-manager pane and returns a transport handle', async () => {
		let activePaneTitle: string | undefined;
		let activePaneId: string | undefined;
		const observed: string[][] = [];
		const executor: NonNullable<TerminalAgentTransportOptions['executor']> = async (args) => {
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
						...(activePaneTitle && activePaneId
							? [{ id: 4, title: activePaneTitle, tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false }]
							: [])
					]),
					stderr: ''
				};
			}
			observed.push(args);
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'new-pane') {
				const nameFlagIndex = args.indexOf('--name');
				activePaneTitle = args[nameFlagIndex + 1];
				activePaneId = 'terminal_4';
				return { stdout: `${activePaneId}\n`, stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'stack-panes') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'focus-pane-id') {
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};

		const transport = new TerminalAgentTransport({ executor, sharedSessionName: 'mission-mission' });
		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			args: ['--experimental']
		});

		expect(observed.some((args) => args[3] === 'new-pane' && args.includes('--tab-id'))).toBe(true);
		expect(observed.some((args) => args[3] === 'stack-panes')).toBe(true);
		expect(observed.some((args) => args[3] === 'focus-pane-id' && args[4] === 'terminal_4')).toBe(true);
		expect(handle.sessionName).toMatch(/^mission-agent-/u);
		expect(handle.paneId).toBe('terminal_4');
	});

	it('uses snake_case tab_id metadata when opening a shared-session pane', async () => {
		const observed: string[][] = [];
		const executor: NonNullable<TerminalAgentTransportOptions['executor']> = async (args) => {
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 7, exited: false, exitStatus: null, is_plugin: false, is_focused: false }
					]),
					stderr: ''
				};
			}
			observed.push(args);
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'new-pane') {
				return { stdout: 'terminal_4\n', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'stack-panes') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'focus-pane-id') {
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};

		const transport = new TerminalAgentTransport({ executor, sharedSessionName: 'mission-mission' });
		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot'
		});

		const newPaneCommand = observed.find((args) => args[3] === 'new-pane');
		expect(newPaneCommand?.includes('--tab-id')).toBe(true);
		expect(observed.some((args) => args[3] === 'stack-panes')).toBe(true);
		expect(observed.some((args) => args[3] === 'focus-pane-id' && args[4] === 'terminal_4')).toBe(true);
	});

	it('attaches to an existing shared-session pane', async () => {
		const executor: NonNullable<TerminalAgentTransportOptions['executor']> = async (args) => {
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
						{ id: 5, title: 'existing-session', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false }
					]),
					stderr: ''
				};
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};

		const transport = new TerminalAgentTransport({ executor, sharedSessionName: 'mission-mission' });
		const handle = await transport.attachSession('existing-session');

		expect(handle).toEqual({
			sessionName: 'existing-session',
			paneId: 'terminal_5'
		});
	});

	it('discovers airport layout session and opens a shared-session pane when sharedSessionName is not configured', async () => {
		const observed: string[][] = [];
		const executor: NonNullable<TerminalAgentTransportOptions['executor']> = async (args) => {
			observed.push(args);
			if (args[0] === 'list-sessions') {
				return {
					stdout: 'flying-pillow-mission | AIRPORT [Created 5m ago]\n',
					stderr: ''
				};
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false }
					]),
					stderr: ''
				};
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'new-pane') {
				return { stdout: 'terminal_4\n', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'stack-panes') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'focus-pane-id') {
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};

		const transport = new TerminalAgentTransport({ executor });
		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot'
		});

		expect(handle.sharedSessionName).toBe('flying-pillow-mission | AIRPORT');
		expect(observed.some((args) => args[0] === 'list-sessions')).toBe(true);
		expect(observed.some((args) => args[0] === '--session' && args[1] === 'flying-pillow-mission | AIRPORT' && args[3] === 'new-pane')).toBe(true);
	});

	it('sends literal text to the shared-session pane process', async () => {
		const observed: string[][] = [];
		const executor: NonNullable<TerminalAgentTransportOptions['executor']> = async (args) => {
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
						{ id: 2, title: 'MISSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: true },
						{ id: 5, title: 'existing-session', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false }
					]),
					stderr: ''
				};
			}
			observed.push(args);
			return { stdout: '', stderr: '' };
		};

		const transport = new TerminalAgentTransport({ executor, sharedSessionName: 'mission-mission' });
		await transport.sendKeys({ sessionName: 'existing-session', paneId: 'terminal_5' }, 'hello', { literal: true });

		expect(observed).toEqual([
			['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_5'],
			['--session', 'mission-mission', 'action', 'write-chars', 'hello'],
			['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_2']
		]);
	});
});
