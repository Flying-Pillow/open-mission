import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig, AgentSessionEvent } from '../AgentRuntimeTypes.js';
import { CopilotCliAgentRunner, type CopilotCliAgentRunnerOptions } from './CopilotCliAgentRunner.js';

type MockTerminalState = {
	exists: boolean;
	capture: string;
	dead: boolean;
	exitCode: number;
	sentKeys: string[][];
};

function createLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
	return {
		missionId: 'mission-1',
		workingDirectory: '/tmp/work',
		task: {
			taskId: 'task-1',
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
		},
		...overrides
	};
}

function createLaunchConfigWithoutInitialPrompt(): AgentLaunchConfig {
	const request = createLaunchConfig();
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
						{ id: 1, title: 'RUNWAY', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: false },
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

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();

		expect(snapshot.runnerId).toBe('copilot-cli');
		expect(snapshot.transport?.kind).toBe('terminal');
		expect(snapshot.sessionId).toBe('task-1-copilot-cli');
		expect(snapshot.transport?.terminalSessionName).toBe('mission-mission');
		expect(snapshot.transport?.paneId).toBe('terminal_4');
		expect(snapshot.status).toBe('running');
		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Implement the task.'))).toBe(true);
	});

	it('falls back to a standalone terminal session when the runway gate pane is unavailable', async () => {
		let standaloneSessionName: string | undefined;
		const fallbackExecutor: NonNullable<CopilotCliAgentRunnerOptions['executor']> = async (args) => {
			if (args[0] === '--version') {
				return { stdout: 'zellij 0.40.1\n', stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'list-panes') {
				return {
					stdout: JSON.stringify([
						{ id: 2, title: 'MISSION', tab_id: 0, exited: false, exitStatus: null, is_plugin: false, is_focused: true }
					]),
					stderr: ''
				};
			}
			if (args[0] === '--new-session-with-layout') {
				standaloneSessionName = args.at(-1);
				return { stdout: '', stderr: '' };
			}
			if (args[0] === 'list-sessions') {
				return {
					stdout: standaloneSessionName ? `${standaloneSessionName} [Created 1s ago]\n` : '',
					stderr: ''
				};
			}
			if (args[0] === '--session' && args[2] === 'action' && args[3] === 'dump-screen') {
				return { stdout: state.capture, stderr: '' };
			}
			if (args[0] === '--session' && args[2] === 'action' && (args[3] === 'write-chars' || args[3] === 'write')) {
				state.sentKeys.push(args);
				return { stdout: '', stderr: '' };
			}
			throw new Error(`Unexpected terminal command: ${args.join(' ')}`);
		};

		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor: fallbackExecutor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();

		expect(snapshot.sessionId).toBe('task-1-copilot-cli');
		expect(snapshot.transport?.terminalSessionName).toBe(snapshot.sessionId);
		expect(snapshot.transport?.paneId).toBeUndefined();
		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Implement the task.'))).toBe(true);
	});

	it('derives a task-based session name from the task path on launch', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig({
			task: {
				taskId: 'spec/01-spec-from-prd',
				stageId: 'spec',
				title: 'Spec from PRD',
				description: 'Spec from PRD',
				instruction: 'Spec from PRD'
			}
		}));

		expect(session.getSnapshot().sessionId).toBe('01-spec-from-prd-copilot-cli');
	});

	it('submits prompts by sending literal keys into terminal transport', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createLaunchConfigWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await session.submitPrompt({ source: 'operator', text: 'Explain the current failure.' });

		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Explain the current failure.'))).toBe(true);
		expect(events.some((event) => event.type === 'session.updated')).toBe(true);
	});

	it('maps interrupt commands to Ctrl+C and awaiting-input state', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createLaunchConfigWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		const snapshot = await session.submitCommand({ type: 'interrupt' });

		expect(state.sentKeys.some((args) => args.includes('write') && args.includes('3'))).toBe(true);
		expect(snapshot.waitingForInput).toBe(true);
		expect(events.find((event) => event.type === 'session.awaiting-input')).toBeDefined();
	});

	it('terminates a session through the runner API', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createLaunchConfigWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});
		await session.terminate('operator requested stop');

		expect(events.some((event) => event.type === 'session.terminated')).toBe(true);
		expect(session.getSnapshot().status).toBe('terminated');
		expect(state.exists).toBe(false);
	});
});