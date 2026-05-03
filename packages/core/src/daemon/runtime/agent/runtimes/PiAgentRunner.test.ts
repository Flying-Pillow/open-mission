import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { CopilotCliAgentRunner } from './CopilotCliAgentRunner.js';
import { PiAgentRunner } from './PiAgentRunner.js';
import type { TerminalExecutor } from '../TerminalAgentTransport.js';

type MockTerminalState = {
	exists: boolean;
	dead: boolean;
	exitCode: number;
	sentKeys: string[][];
	launchCommands: string[];
	activeSessionName: string | undefined;
};

function createLaunchConfig(taskId = 'task-1'): AgentLaunchConfig {
	return {
		missionId: 'mission-1',
		workingDirectory: '/tmp/work',
		task: {
			taskId,
			stageId: 'implementation',
			title: 'Implement the task',
			description: 'Implement the task',
			instruction: 'Implement the task.'
		},
		specification: {
			summary: 'Implement the task.',
			documents: []
		},
		resume: { mode: 'new' },
		initialPrompt: {
			source: 'engine',
			text: 'Implement the task.'
		}
	};
}

function createExecutor(state: MockTerminalState): TerminalExecutor {
	return async (args) => {
		if (args[0] === '--version') {
			return { stdout: 'zellij 0.40.1\n', stderr: '' };
		}
		if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
			return {
				stdout: JSON.stringify([
					{ id: 1, title: 'RUNWAY', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
					{ id: 2, title: 'MISSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: true },
					...(state.exists && state.activeSessionName
						? [{ id: 4, title: state.activeSessionName, tab_id: 0, exited: state.dead, exitStatus: state.dead ? state.exitCode : null, is_plugin: false, is_focused: false }]
						: [])
				]),
				stderr: ''
			};
		}
		if (args[0] === '--session' && args[2] === 'action' && args[3] === 'new-pane') {
			state.activeSessionName = args[8];
			state.launchCommands.push(args.at(-1) ?? '');
			return { stdout: 'terminal_4\n', stderr: '' };
		}
		if (args[0] === '--session' && args[2] === 'action' && (args[3] === 'stack-panes' || args[3] === 'focus-pane-id')) {
			return { stdout: '', stderr: '' };
		}
		if (args[0] === '--session' && args[2] === 'action' && (args[3] === 'write-chars' || args[3] === 'write')) {
			state.sentKeys.push(args);
			return { stdout: '', stderr: '' };
		}
		if (args[0] === '--session' && args[2] === 'action' && args[3] === 'dump-screen') {
			return { stdout: '', stderr: '' };
		}
		if (args[0] === '--session' && args[2] === 'action' && args[3] === 'close-pane') {
			state.exists = false;
			return { stdout: '', stderr: '' };
		}
		throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
	};
}

describe('PiAgentRunner', () => {
	let state: MockTerminalState;

	beforeEach(() => {
		vi.useFakeTimers();
		state = {
			exists: true,
			dead: false,
			exitCode: 0,
			sentKeys: [],
			launchCommands: [],
			activeSessionName: undefined
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('differs from Copilot only by runner identity and launch command', async () => {
		const copilot = new CopilotCliAgentRunner({
			command: 'copilot',
			executor: createExecutor(state),
			sharedSessionMode: 'enabled',
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const copilotSession = await copilot.startSession(createLaunchConfig('task-1'));
		const copilotSnapshot = copilotSession.getSnapshot();
		const copilotLaunchCommand = state.launchCommands.at(-1);

		state.sentKeys = [];
		state.launchCommands = [];
		state.activeSessionName = undefined;
		state.exists = true;

		const pi = new PiAgentRunner({
			command: 'pi',
			executor: createExecutor(state),
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const piSession = await pi.startSession(createLaunchConfig('task-1'));
		const piSnapshot = piSession.getSnapshot();
		const piLaunchCommand = state.launchCommands.at(-1);

		expect(copilotSnapshot.status).toBe('running');
		expect(piSnapshot.status).toBe('running');
		expect(copilotSnapshot.transport).toEqual({ kind: 'terminal', terminalSessionName: 'mission-mission', paneId: 'terminal_4' });
		expect(piSnapshot.transport).toEqual({ kind: 'terminal', terminalSessionName: 'mission-mission', paneId: 'terminal_4' });
		expect(copilotSnapshot.runnerId).toBe('copilot-cli');
		expect(piSnapshot.runnerId).toBe('pi');
		expect(copilotSnapshot.sessionId).toBe('task-1-copilot-cli');
		expect(piSnapshot.sessionId).toBe('task-1-pi');
		expect(copilotLaunchCommand).toContain('copilot');
		expect(piLaunchCommand).toContain('pi');
	});
});