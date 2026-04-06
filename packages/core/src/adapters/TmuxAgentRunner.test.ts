import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent, AgentSessionStartRequest } from '../runtime/AgentRuntimeTypes.js';
import { TmuxAgentRunner, type TmuxAgentRunnerOptions } from './TmuxAgentRunner.js';

type MockTmuxState = {
	exists: boolean;
	paneId: string;
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

describe('TmuxAgentRunner', () => {
	let state: MockTmuxState;
	let executor: NonNullable<TmuxAgentRunnerOptions['executor']>;

	beforeEach(() => {
		vi.useFakeTimers();
		state = {
			exists: true,
			paneId: '%1',
			capture: '',
			dead: false,
			exitCode: 0,
			sentKeys: []
		};
		executor = async (args) => {
			if (args[0] === '-V') {
				return { stdout: 'tmux 3.4\n', stderr: '' };
			}
			if (args[0] === 'new-session') {
				return { stdout: 'mission-agent-test %1\n', stderr: '' };
			}
			if (args[0] === 'set-option') {
				return { stdout: '', stderr: '' };
			}
			if (args[0] === 'send-keys') {
				state.sentKeys.push(args);
				return { stdout: '', stderr: '' };
			}
			if (args[0] === 'has-session') {
				if (!state.exists) {
					throw new Error('missing session');
				}
				return { stdout: '', stderr: '' };
			}
			if (args[0] === 'display-message' && args[4] === '#{pane_id}') {
				return { stdout: `${state.paneId}\n`, stderr: '' };
			}
			if (args[0] === 'display-message' && args[4] === '#{pane_dead} #{pane_dead_status}') {
				return { stdout: `${state.dead ? '1' : '0'} ${String(state.exitCode)}\n`, stderr: '' };
			}
			if (args[0] === 'capture-pane') {
				return { stdout: state.capture, stderr: '' };
			}
			if (args[0] === 'kill-session') {
				state.exists = false;
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected tmux command: ${args.join(' ')}`);
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts a tmux-backed session and injects the initial prompt', async () => {
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			args: ['--add-dir', '/tmp/work'],
			executor,
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createStartRequest());
		const snapshot = session.getSnapshot();

		expect(snapshot.runnerId).toBe('tmux');
		expect(snapshot.sessionId).toBe('mission-agent-test');
		expect(snapshot.phase).toBe('running');
		expect(state.sentKeys.some((args) => args.includes('-l') && args.includes('Implement the task.'))).toBe(true);
	});

	it('accepts prompt submission by sending literal keys into tmux', async () => {
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			executor,
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await session.submitPrompt({ source: 'operator', text: 'Explain the current failure.' });

		expect(state.sentKeys.some((args) => args.includes('-l') && args.includes('Explain the current failure.'))).toBe(true);
		expect(events.find((event) => event.type === 'prompt.accepted')).toBeDefined();
	});

	it('maps interrupt commands to Ctrl+C and awaiting-input state', async () => {
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			executor,
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		const snapshot = await session.submitCommand({ kind: 'interrupt' });

		expect(state.sentKeys.some((args) => args.includes('C-c'))).toBe(true);
		expect(snapshot.awaitingInput).toBe(true);
		expect(events.find((event) => event.type === 'command.accepted')).toBeDefined();
		expect(events.find((event) => event.type === 'session.awaiting-input')).toBeDefined();
	});

	it('rejects unsupported structured commands', async () => {
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			executor,
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await expect(session.submitCommand({ kind: 'finish' })).rejects.toThrow("Command 'finish' is unsupported");
		expect(events.find((event) => event.type === 'command.rejected')).toBeDefined();
	});

	it('detects terminal completion from tmux pane state', async () => {
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			executor,
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createStartRequestWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		state.capture = 'Working...\nDone.\n';
		state.dead = true;
		state.exitCode = 0;

		await vi.advanceTimersByTimeAsync(600);

		expect(events.some((event) => event.type === 'session.message' && event.text === 'Working...')).toBe(true);
		expect(events.some((event) => event.type === 'session.completed')).toBe(true);
		expect(session.getSnapshot().phase).toBe('completed');
	});

	it('materializes a terminated attachment when tmux no longer has the session', async () => {
		state.exists = false;
		const runner = new TmuxAgentRunner({
			command: 'copilot',
			executor,
			pollIntervalMs: 500
		});
		const session = await runner.attachSession({
			runnerId: 'tmux',
			sessionId: 'missing-session'
		});
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await Promise.resolve();
		await Promise.resolve();

		expect(session.getSnapshot().phase).toBe('terminated');
		expect(events[0]?.type).toBe('session.terminated');
	});
});