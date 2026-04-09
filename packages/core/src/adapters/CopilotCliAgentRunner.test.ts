import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent, AgentSessionStartRequest } from '../runtime/AgentRuntimeTypes.js';
import { CopilotCliAgentRunner, type CopilotCliAgentRunnerOptions } from './CopilotCliAgentRunner.js';

type MockTerminalState = {
	exists: boolean;
	capture: string;
	dead: boolean;
	exitCode: number;
	sentKeys: string[][];
};

function createStartRequest(overrides: Partial<AgentSessionStartRequest> = {}): AgentSessionStartRequest {
	return {
		missionId: 'mission-1',
		taskId: 'task-1',
		workingDirectory: '/tmp/work',
		initialPrompt: {
			source: 'engine',
			text: 'Implement the task.'
		},
		...overrides
	};
}

function createStartRequestWithoutInitialPrompt(): AgentSessionStartRequest {
	const request = createStartRequest();
	delete request.initialPrompt;
	return request;
}

describe('CopilotCliAgentRunner', () => {
	let state: MockTerminalState;
	let executor: NonNullable<CopilotCliAgentRunnerOptions['executor']>;
	let activeSessionName: string | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		state = {
			exists: true,
			capture: '',
			dead: false,
			exitCode: 0,
			sentKeys: []
		};
		activeSessionName = undefined;
		executor = async (args) => {
			if (args[0] === '--version') {
				return { stdout: 'zellij 0.40.1\n', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 1, title: 'AGENT SESSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
						{ id: 2, title: 'MISSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: true },
						...(state.exists && activeSessionName
							? [{ id: 4, title: activeSessionName, tab_id: 0, exited: state.dead, exitStatus: state.dead ? state.exitCode : null, is_plugin: false, is_focused: false }]
							: [])
					]),
					stderr: ''
				};
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'new-pane') {
				activeSessionName = args[8];
				return { stdout: 'terminal_4\n', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'stack-panes') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'focus-pane-id') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && (args[3] === 'write-chars' || args[3] === 'write')) {
				state.sentKeys.push(args);
				return { stdout: '', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'dump-screen') {
				return { stdout: state.capture, stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'close-pane') {
				state.exists = false;
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts a terminal-backed session and injects the initial prompt', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			args: ['--add-dir', '/tmp/work'],
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createStartRequest());
		const snapshot = session.getSnapshot();

		expect(snapshot.runtimeId).toBe('copilot-cli');
		expect(snapshot.transportId).toBe('terminal');
		expect(snapshot.sessionId).toMatch(/^mission-agent-/u);
		expect(snapshot.phase).toBe('running');
		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Implement the task.'))).toBe(true);
	});

	it('accepts prompt submission by sending literal keys into terminal transport', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await session.submitPrompt({ source: 'operator', text: 'Explain the current failure.' });

		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Explain the current failure.'))).toBe(true);
		expect(events.find((event) => event.type === 'prompt.accepted')).toBeDefined();
	});

	it('maps interrupt commands to Ctrl+C and awaiting-input state', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		const snapshot = await session.submitCommand({ kind: 'interrupt' });

		expect(state.sentKeys.some((args) => args.includes('write') && args.includes('3'))).toBe(true);
		expect(snapshot.awaitingInput).toBe(true);
		expect(events.find((event) => event.type === 'command.accepted')).toBeDefined();
		expect(events.find((event) => event.type === 'session.awaiting-input')).toBeDefined();
	});

	it('terminates a session through the runner API', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});
		await session.terminate('operator requested stop');

		expect(events.some((event) => event.type === 'session.terminated')).toBe(true);
		expect(session.getSnapshot().phase).toBe('terminated');
		expect(state.exists).toBe(false);
	});
});