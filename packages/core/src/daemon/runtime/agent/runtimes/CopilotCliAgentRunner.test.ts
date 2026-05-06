import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig, AgentSessionEvent } from '../AgentRuntimeTypes.js';
import { CopilotCliAgentRunner } from './CopilotCliAgentRunner.js';

type MockTerminalState = {
	spawnedCommand: string;
	spawnedArgs: string[];
	writes: string[];
	killCount: number;
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
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();

		expect(snapshot.runnerId).toBe('copilot-cli');
		expect(snapshot.transport?.kind).toBe('terminal');
		expect(snapshot.sessionId).toMatch(/^task-1-copilot-cli-[a-z0-9]{8}$/);
		expect(snapshot.transport?.terminalSessionName.endsWith(`:mission-1:task-1:${snapshot.sessionId}`)).toBe(true);
		expect(snapshot.transport?.paneId).toBe('pty');
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
		expect(state.spawnedArgs).toContain('Implement the task.');
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

		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});

		const session = await runner.startSession(createLaunchConfig());
		const snapshot = session.getSnapshot();
		const persistedSettings = JSON.parse(
			await fs.readFile(path.join(trustedConfigDir, 'settings.json'), 'utf8')
		) as { trustedFolders?: string[]; trusted_folders?: string[] };

		expect(snapshot.status).toBe('running');
		expect(persistedSettings.trustedFolders).toContain('/tmp/work');
		expect(persistedSettings.trusted_folders).toContain('/tmp/work');
	});

	it('derives a task-based session name from the task path on launch', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
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
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});

		const firstSession = await runner.startSession(createLaunchConfig());
		const secondSession = await runner.startSession(createLaunchConfig());

		expect(firstSession.getSnapshot().sessionId).not.toBe(secondSession.getSnapshot().sessionId);
	});

	it('submits prompts by sending literal keys into terminal transport', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createLaunchConfigWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		await session.submitPrompt({ source: 'operator', text: 'Explain the current failure.' });

		expect(state.writes).toContain('Explain the current failure.');
		expect(state.writes).toContain('\r');
		expect(events.some((event) => event.type === 'session.updated')).toBe(true);
	});

	it('maps interrupt commands to Ctrl+C and awaiting-input state', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});
		const session = await runner.startSession(createLaunchConfigWithoutInitialPrompt());
		const events: AgentSessionEvent[] = [];
		session.onDidEvent((event) => {
			events.push(event);
		});

		const snapshot = await session.submitCommand({ type: 'interrupt' });

		expect(state.writes).toContain('\x03');
		expect(snapshot.waitingForInput).toBe(true);
		expect(events.find((event) => event.type === 'session.awaiting-input')).toBeDefined();
	});

	it('terminates a session through the runner API', async () => {
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
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
		expect(state.killCount).toBe(1);
	});

	it('trusts mission dossier cwd and mission root ancestor when launching', async () => {
		const missionDossierWorkingDirectory = '/tmp/mission-root/.mission/missions/mission-13';
		const missionRootDirectory = '/tmp/mission-root';
		const runner = new CopilotCliAgentRunner({
			command: 'copilot',
			trustedConfigDir,
			env: { PATH: runtimeDirectory },
			spawn: createSpawn(state, () => createFakePty(state)),
			pollIntervalMs: 500
		});

		await runner.startSession(createLaunchConfig({
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

	it('passes Mission MCP launch env through without generating runner-specific MCP config', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-copilot-workspace-'));
		try {
			const runner = new CopilotCliAgentRunner({
				command: 'copilot',
				trustedConfigDir,
				env: { PATH: runtimeDirectory },
				spawn: createSpawn(state, () => createFakePty(state)),
				pollIntervalMs: 500,
				mcpProvisioner: {
					provision: async () => ({
						runnerId: 'copilot-cli',
						policy: 'optional',
						accessState: 'mcp-validated',
						launchEnv: {
							MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/session-1',
							MISSION_MCP_SESSION_TOKEN: 'token-1'
						},
						generatedFiles: [],
						cleanup: async () => undefined
					})
				} as never
			});

			await runner.startSession(createLaunchConfig({
				workingDirectory: workspaceRoot
			}));

			expect(state.spawnedArgs).not.toContain('--additional-mcp-config');
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
