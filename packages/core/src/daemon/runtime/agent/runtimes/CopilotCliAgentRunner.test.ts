import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig, AgentSessionEvent } from '../AgentRuntimeTypes.js';
import { CopilotCliAgentRunner, type CopilotCliAgentRunnerOptions } from './CopilotCliAgentRunner.js';

const TEST_TRUSTED_CONFIG_DIR = '/tmp/mission-copilot-runner-config';

type MockTerminalState = {
	exists: boolean;
	capture: string;
	dead: boolean;
	exitCode: number;
	sentKeys: string[][];
	lastLaunchCommand: string;
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

	beforeEach(async () => {
		vi.useFakeTimers();
		await fs.rm(TEST_TRUSTED_CONFIG_DIR, { recursive: true, force: true });
		state = {
			exists: true,
			capture: '',
			dead: false,
			exitCode: 0,
			sentKeys: [],
			lastLaunchCommand: ''
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
				state.lastLaunchCommand = args.at(-1) ?? '';
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

	afterEach(async () => {
		await fs.rm(TEST_TRUSTED_CONFIG_DIR, { recursive: true, force: true });
		vi.useRealTimers();
	});

	it('starts a terminal-backed session and passes the initial prompt via launch args', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			args: ['--add-dir', '/tmp/work'],
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();

		expect(snapshot.runnerId).toBe('copilot-cli');
		expect(snapshot.transport?.kind).toBe('terminal');
		expect(snapshot.sessionId).toMatch(/^task-1-copilot-cli-[a-z0-9]{8}$/);
		expect(snapshot.transport?.terminalSessionName).toBe('mission-mission');
		expect(snapshot.transport?.paneId).toBe('terminal_4');
		expect(snapshot.status).toBe('running');
		expect(state.lastLaunchCommand).toContain("'--allow-all-paths'");
		expect(state.lastLaunchCommand).toContain("'--allow-all-tools'");
		expect(state.lastLaunchCommand).toContain("'--allow-all-urls'");
		expect(state.lastLaunchCommand).toContain("'--config-dir'");
		expect(state.lastLaunchCommand).toContain(`'${TEST_TRUSTED_CONFIG_DIR}'`);
		expect(state.lastLaunchCommand).toContain("'--add-dir'");
		expect(state.lastLaunchCommand).toContain("'/tmp/work'");
		expect(state.lastLaunchCommand).toContain("'-i'");
		expect(state.lastLaunchCommand).toContain("'Implement the task.'");
		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Implement the task.'))).toBe(false);
	});

	it('stores trusted folders in settings.json without reading managed config.json', async () => {
		await fs.mkdir(TEST_TRUSTED_CONFIG_DIR, { recursive: true });
		await fs.writeFile(
			path.join(TEST_TRUSTED_CONFIG_DIR, 'config.json'),
			[
				'// User settings belong in settings.json.',
				'// This file is managed automatically.',
				'{',
				'  "trustedFolders": ["/tmp/already-trusted"]',
				'}'
			].join('\n'),
			'utf8'
		);

		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();
		const persistedSettings = JSON.parse(
			await fs.readFile(path.join(TEST_TRUSTED_CONFIG_DIR, 'settings.json'), 'utf8')
		) as { trustedFolders?: string[]; trusted_folders?: string[] };

		expect(snapshot.status).toBe('running');
		expect(persistedSettings.trustedFolders).toContain('/tmp/work');
		expect(persistedSettings.trusted_folders).toContain('/tmp/work');
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
				const layoutPath = args[1];
				if (layoutPath) {
					const layout = await fs.readFile(layoutPath, 'utf8');
					state.lastLaunchCommand = layout;
				}
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
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
			executor: fallbackExecutor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();

		expect(snapshot.sessionId).toMatch(/^task-1-copilot-cli-[a-z0-9]{8}$/);
		expect(snapshot.transport?.terminalSessionName).toBe(snapshot.sessionId);
		expect(snapshot.transport?.paneId).toBeUndefined();
		expect(state.lastLaunchCommand).toContain("'-i'");
		expect(state.lastLaunchCommand).toContain("'Implement the task.'");
		expect(state.sentKeys.some((args) => args.includes('write-chars') && args.includes('Implement the task.'))).toBe(false);
	});

	it('derives a task-based session name from the task path on launch', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
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

		expect(session.getSnapshot().sessionId).toMatch(/^01-spec-from-prd-copilot-cli-[a-z0-9]{8}$/);
	});

	it('creates a fresh session id for each new launch of the same task', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		const firstSession = await runner.startSession(createLaunchConfig());
		const secondSession = await runner.startSession(createLaunchConfig());

		expect(firstSession.getSnapshot().sessionId).not.toBe(secondSession.getSnapshot().sessionId);
	});

	it('submits prompts by sending literal keys into terminal transport', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
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
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
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
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
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

	it('trusts mission dossier cwd and mission root ancestor when launching', async () => {
		const missionDossierWorkingDirectory = '/tmp/mission-root/.mission/missions/mission-13';
		const missionRootDirectory = '/tmp/mission-root';
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir: TEST_TRUSTED_CONFIG_DIR,
			sharedSessionMode: 'enabled',
			executor,
			sharedSessionName: 'mission-mission',
			pollIntervalMs: 500
		});

		await runner.startSession(createLaunchConfig({
			workingDirectory: missionDossierWorkingDirectory
		}));

		expect(state.lastLaunchCommand).toContain(`'${missionDossierWorkingDirectory}'`);
		expect(state.lastLaunchCommand).toContain(`'${missionRootDirectory}'`);

		const config = JSON.parse(
			await fs.readFile(`${TEST_TRUSTED_CONFIG_DIR}/config.json`, 'utf8')
		) as { trusted_folders?: string[] };
		expect(config.trusted_folders).toContain(missionDossierWorkingDirectory);
		expect(config.trusted_folders).toContain(missionRootDirectory);
	});
});