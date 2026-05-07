import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	AgentCommand,
	AgentExecutionEvent,
	AgentExecutionSnapshot,
	AgentLaunchConfig,
	AgentPrompt
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { Agent } from '../../../../entities/Agent/Agent.js';
import { AgentRegistry } from '../../../../entities/Agent/AgentRegistry.js';
import { createAgentAdapter, type AgentAdapter } from '../AgentAdapter.js';
import { AgentExecutor } from '../AgentExecutor.js';
import { createCopilot } from './Copilot.js';

type MockTerminalState = {
	spawnedCommand: string;
	spawnedArgs: string[];
	writes: string[];
	killCount: number;
};

function createLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
	return {
		scope: {
			kind: 'task',
			missionId: 'mission-1',
			taskId: 'task-1',
			stageId: 'implementation'
		},
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

type StartedTerminalExecution = {
	getSnapshot(): AgentExecutionSnapshot;
	onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void };
	submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
	submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
	terminate(reason?: string): Promise<AgentExecutionSnapshot>;
};

async function startExecution(
	adapter: AgentAdapter,
	config: AgentLaunchConfig
): Promise<StartedTerminalExecution> {
	const executor = new AgentExecutor({
		agentRegistry: new AgentRegistry({
			agents: [await Agent.fromAdapter(adapter)]
		})
	});
	const execution = await executor.startExecution(config);
	const sessionId = execution.getSnapshot().sessionId;
	return {
		getSnapshot: () => execution.getSnapshot(),
		onDidEvent: (listener) => execution.onDidEvent(listener),
		submitPrompt: (prompt) => executor.submitPrompt(sessionId, prompt),
		submitCommand: (command) => executor.submitCommand(sessionId, command),
		terminate: (reason) => executor.terminateExecution(sessionId, reason)
	};
}

describe('Copilot', () => {
	let state: MockTerminalState;
	let runtimeDirectory: string;
	let trustedConfigDir: string;
	let copilotScriptPath: string;

	beforeEach(async () => {
		vi.useFakeTimers();
		runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-copilot-cli-'));
		trustedConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-copilot-config-'));
		copilotScriptPath = path.join(runtimeDirectory, 'copilot');
		await fs.writeFile(copilotScriptPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });
		state = {
			spawnedCommand: '',
			spawnedArgs: [],
			writes: [],
			killCount: 0
		};
	});

	afterEach(async () => {
		await fs.rm(runtimeDirectory, { recursive: true, force: true });
		await fs.rm(trustedConfigDir, { recursive: true, force: true });
		vi.useRealTimers();
	});

	it('starts a PTY-backed session and passes the initial prompt via launch args', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});

		const execution = await startExecution(adapter, createLaunchConfig());
		const snapshot = execution.getSnapshot();

		expect(snapshot.agentId).toBe('copilot-cli');
		expect(snapshot.transport?.kind).toBe('terminal');
		expect(snapshot.sessionId).toMatch(/^task-1-copilot-cli-[a-z0-9]{8}$/);
		expect(snapshot.transport?.terminalName.endsWith(`:task:task-1:${snapshot.sessionId}`)).toBe(true);
		expect(snapshot.transport?.terminalPaneId).toBe('pty');
		expect(snapshot.status).toBe('running');
		expect(state.spawnedCommand).toBe('/bin/sh');
		expect(state.spawnedArgs).toContain(copilotScriptPath);
		expect(state.spawnedArgs).toContain('--allow-all-paths');
		expect(state.spawnedArgs).toContain('--allow-all-tools');
		expect(state.spawnedArgs).toContain('--allow-all-urls');
		expect(state.spawnedArgs).toContain('--config-dir');
		expect(state.spawnedArgs).toContain(trustedConfigDir);
		expect(state.spawnedArgs).toContain('--add-dir');
		expect(state.spawnedArgs).toContain('/tmp/work');
		expect(state.spawnedArgs).toContain('-i');
		expect(state.spawnedArgs.some((arg) => arg.includes('Implement the task.'))).toBe(true);
		expect(state.spawnedArgs.some((arg) => arg.includes('Agent execution structured interaction is mandatory'))).toBe(true);
		expect(state.spawnedArgs.some((arg) => arg.includes('task::'))).toBe(true);
		expect(state.writes).not.toContain('Implement the task.');
	});

	it('stores trusted folders in settings.json without reading managed config.json', async () => {
		await fs.mkdir(trustedConfigDir, { recursive: true });
		await fs.writeFile(
			path.join(trustedConfigDir, 'config.json'),
			[
				'// User settings belong in settings.json.',
				'// This file is managed automatically.',
				'{',
				'  "trustedFolders": ["/tmp/already-trusted"]',
				'}'
			].join('\n'),
			'utf8'
		);

		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});

		const execution = await startExecution(adapter, createLaunchConfig());
		const snapshot = execution.getSnapshot();
		const persistedSettings = JSON.parse(
			await fs.readFile(path.join(trustedConfigDir, 'settings.json'), 'utf8')
		) as { trustedFolders?: string[]; trusted_folders?: string[] };

		expect(snapshot.status).toBe('running');
		expect(persistedSettings.trustedFolders).toContain('/tmp/work');
		expect(persistedSettings.trusted_folders).toContain('/tmp/work');
	});

	it('derives the session name from the explicit task execution scope on launch', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});

		const execution = await startExecution(adapter, createLaunchConfig({
			scope: {
				kind: 'task',
				missionId: 'mission-1',
				taskId: 'spec/01-spec-from-prd',
				stageId: 'spec'
			},
			task: {
				taskId: 'spec/01-spec-from-prd',
				stageId: 'spec',
				title: 'Spec from PRD',
				description: 'Spec from PRD',
				instruction: 'Spec from PRD'
			}
		}));

		expect(execution.getSnapshot().sessionId).toMatch(/^01-spec-from-prd-copilot-cli-[a-z0-9]{8}$/);
	});

	it('creates a fresh session id for each new launch of the same task', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});

		const firstSession = await startExecution(adapter, createLaunchConfig());
		const secondSession = await startExecution(adapter, createLaunchConfig());

		expect(firstSession.getSnapshot().sessionId).not.toBe(secondSession.getSnapshot().sessionId);
	});

	it('submits prompts by sending literal keys into terminal transport', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});
		const execution = await startExecution(adapter, createLaunchConfigWithoutInitialPrompt());
		const events: AgentExecutionEvent[] = [];
		execution.onDidEvent((event) => {
			events.push(event);
		});

		await execution.submitPrompt({ source: 'operator', text: 'Explain the current failure.' });

		expect(state.writes).toContain('Explain the current failure.');
		expect(state.writes).toContain('\r');
		expect(events.some((event) => event.type === 'execution.updated')).toBe(true);
	});

	it('maps interrupt commands to Ctrl+C and awaiting-input state', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});
		const execution = await startExecution(adapter, createLaunchConfigWithoutInitialPrompt());
		const events: AgentExecutionEvent[] = [];
		execution.onDidEvent((event) => {
			events.push(event);
		});

		const snapshot = await execution.submitCommand({ type: 'interrupt' });

		expect(state.writes).toContain('\x03');
		expect(snapshot.waitingForInput).toBe(true);
		expect(events.find((event) => event.type === 'execution.awaiting-input')).toBeDefined();
	});

	it('terminates a session through the adapter API', async () => {
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});
		const execution = await startExecution(adapter, createLaunchConfigWithoutInitialPrompt());
		const events: AgentExecutionEvent[] = [];
		execution.onDidEvent((event) => {
			events.push(event);
		});
		await execution.terminate('operator requested stop');

		expect(events.some((event) => event.type === 'execution.terminated')).toBe(true);
		expect(execution.getSnapshot().status).toBe('terminated');
		expect(state.killCount).toBe(1);
	});

	it('trusts mission dossier cwd and mission root ancestor when launching', async () => {
		const missionDossierWorkingDirectory = '/tmp/mission-root/.mission/missions/mission-13';
		const missionRootDirectory = '/tmp/mission-root';
		const adapter = createAgentAdapter(createCopilot({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
		}), {});

		await startExecution(adapter, createLaunchConfig({
			workingDirectory: missionDossierWorkingDirectory
		}));

		expect(state.spawnedArgs).toContain(missionDossierWorkingDirectory);
		expect(state.spawnedArgs).toContain(missionRootDirectory);

		const settings = JSON.parse(
			await fs.readFile(`${trustedConfigDir}/settings.json`, 'utf8')
		) as { trustedFolders?: string[]; trusted_folders?: string[] };
		expect(settings.trustedFolders).toContain(missionDossierWorkingDirectory);
		expect(settings.trustedFolders).toContain(missionRootDirectory);
		expect(settings.trusted_folders).toContain(missionDossierWorkingDirectory);
		expect(settings.trusted_folders).toContain(missionRootDirectory);
	});

	it('launches successfully with caller-provided launch env', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-copilot-workspace-'));
		try {
			const adapter = createAgentAdapter(createCopilot({
				command: 'copilot',
				trustedConfigDir,
				env: { PATH: runtimeDirectory },
				spawn: createSpawn(state, () => createFakePty(state)),
			}), {});

			await startExecution(adapter, createLaunchConfig({
				workingDirectory: workspaceRoot,
				launchEnv: {
					MISSION_AGENT_ENV_FIXTURE: 'enabled'
				}
			}));

			expect(state.spawnedArgs).toContain(copilotScriptPath);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});

type FakePty = IPty & {
	writes: string[];
	killCount: number;
	emitExit(exitCode?: number): void;
};

function createSpawn(
	state: MockTerminalState,
	createPty: () => FakePty
): (command: string, args: string | string[]) => FakePty {
	return ((command: string, args: string | string[]) => {
		state.spawnedCommand = command;
		state.spawnedArgs = Array.isArray(args) ? [...args] : [args];
		return createPty();
	}) as never;
}

function createFakePty(state: MockTerminalState): FakePty {
	let onDataListener: ((chunk: string) => void) | undefined;
	let onExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
	const fakePty = {
		pid: 1,
		process: 'fake-shell',
		cols: 120,
		rows: 32,
		handleFlowControl: false,
		writes: [] as string[],
		killCount: 0,
		write(data: string) {
			fakePty.writes.push(data);
			state.writes.push(data);
			onDataListener?.(data);
		},
		resize() { },
		kill() {
			fakePty.killCount += 1;
			state.killCount += 1;
			onExitListener?.({ exitCode: 0 });
		},
		clear() { },
		onData(listener: (chunk: string) => void) {
			onDataListener = listener;
			return { dispose() { } };
		},
		onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
			onExitListener = listener;
			return { dispose() { } };
		},
		emitExit(exitCode = 0) {
			onExitListener?.({ exitCode });
		},
		pause() { },
		resume() { },
		setEncoding() { },
		addListener() {
			return fakePty;
		},
		removeListener() {
			return fakePty;
		},
		once() {
			return fakePty;
		},
		removeAllListeners() {
			return fakePty;
		},
		listeners() {
			return [];
		},
		rawListeners() {
			return [];
		},
		emit() {
			return true;
		},
		listenerCount() {
			return 0;
		},
		prependListener() {
			return fakePty;
		},
		prependOnceListener() {
			return fakePty;
		},
		eventNames() {
			return [];
		}
	} as FakePty;
	return fakePty;
}
