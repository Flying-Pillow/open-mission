import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { describe, expect, it } from 'vitest';
import { TerminalAgentTransport } from './TerminalAgentTransport.js';

type FakePty = IPty & {
	emitData(chunk: string): void;
	emitExit(exitCode?: number): void;
	writes: string[];
	resizes: Array<{ cols: number; rows: number }>;
	killCount: number;
};

describe('TerminalAgentTransport', () => {
	it('opens a PTY-backed session and reattaches to it', async () => {
		const ptys: FakePty[] = [];
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				const pty = createFakePty();
				ptys.push(pty);
				return pty;
			}) as never
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			args: ['--allow-all-tools'],
			sessionName: '01-spec-from-prd-copilot-cli'
		});

		expect(handle).toEqual({
			sessionName: '01-spec-from-prd-copilot-cli',
			paneId: 'pty'
		});
		expect(await transport.attachSession('01-spec-from-prd-copilot-cli')).toEqual(handle);
		expect(ptys).toHaveLength(1);
	});

	it('adds a numeric suffix when a requested session name already exists', async () => {
		const transport = new TerminalAgentTransport({
			spawn: (() => createFakePty()) as never
		});

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'existing-session'
		});
		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'existing-session'
		});

		expect(handle.sessionName).toBe('existing-session-2');
	});

	it('captures PTY output and reports exit state', async () => {
		let activePty: FakePty | undefined;
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				activePty = createFakePty(4242);
				return activePty;
			}) as never
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'capture-session'
		});
		activePty?.emitData('hello');
		activePty?.emitData('\r\nworld');

		expect(await transport.capturePane(handle)).toBe('hello\r\nworld');
		expect(await transport.readPaneState(handle)).toEqual({
			dead: false,
			exitCode: null
		});
		expect(await transport.readSnapshot(handle)).toMatchObject({ truncated: false });
		expect(await transport.readSnapshot(handle)).toMatchObject({
			processLease: {
				pid: 4242,
				processGroupId: 4242,
				command: expect.any(String),
				args: expect.any(Array),
				workingDirectory: '/tmp/work',
				startedAt: expect.any(String)
			}
		});

		activePty?.emitExit(7);

		expect(await transport.readPaneState(handle)).toEqual({
			dead: true,
			exitCode: 7
		});
	});

	it('translates control keys and resizes the PTY', async () => {
		let activePty: FakePty | undefined;
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				activePty = createFakePty();
				return activePty;
			}) as never
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'input-session'
		});
		await transport.sendKeys(handle, 'Enter');
		await transport.sendKeys(handle, 'C-c');
		await transport.sendKeys(handle, 'abc', { literal: true });
		await transport.resizeSession(handle, 140, 48);

		expect(activePty?.writes).toEqual(['\r', '\x03', 'abc']);
		expect(activePty?.resizes).toEqual([{ cols: 140, rows: 48 }]);
	});

	it('broadcasts session updates for live terminal subscribers', async () => {
		let activePty: FakePty | undefined;
		const spawn = (() => {
			activePty = createFakePty();
			return activePty;
		}) as never;
		const transport = new TerminalAgentTransport({ spawn });
		const observed: string[] = [];
		const subscription = TerminalAgentTransport.onDidSessionUpdate((event) => {
			if (event.sessionName === 'live-session') {
				observed.push(event.screen);
			}
		}, { spawn });

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'live-session'
		});
		activePty?.emitData('hello');
		activePty?.emitData(' world');

		subscription.dispose();
		expect(observed).toEqual(['hello', 'hello world']);
	});

	it('includes emitted chunks in live terminal subscriber updates', async () => {
		let activePty: FakePty | undefined;
		const spawn = (() => {
			activePty = createFakePty();
			return activePty;
		}) as never;
		const transport = new TerminalAgentTransport({ spawn });
		const observed: string[] = [];
		const subscription = TerminalAgentTransport.onDidSessionUpdate((event) => {
			if (event.sessionName === 'chunk-session') {
				observed.push(event.chunk);
			}
		}, { spawn });

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'chunk-session'
		});
		activePty?.emitData('hello');
		activePty?.emitData(' world');

		subscription.dispose();
		expect(observed).toEqual(['hello', ' world']);
	});

	it('stores owner metadata without binding terminal sessions to missions', async () => {
		let activePty: FakePty | undefined;
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				activePty = createFakePty(5151);
				return activePty;
			}) as never
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'owner-session',
			owner: { kind: 'repository', repositoryRootPath: '/tmp/work' }
		});
		activePty?.emitData('ready');

		expect(await transport.readSnapshot(handle)).toMatchObject({
			owner: { kind: 'repository', repositoryRootPath: '/tmp/work' },
			processLease: {
				pid: 5151,
				processGroupId: 5151
			}
		});
	});

	it('does not report termination until the PTY confirms exit', async () => {
		let activePty: FakePty | undefined;
		const processGroupSignals: string[] = [];
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				activePty = createFakePty(6262);
				return activePty;
			}) as never,
			terminationGraceMs: 0,
			terminationPollIntervalMs: 1,
			processController: {
				isProcessRunning: () => true,
				killProcess: (_processId, signal) => processGroupSignals.push(`process:${signal}`),
				killProcessGroup: (_processGroupId, signal) => processGroupSignals.push(`group:${signal}`)
			}
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'stubborn-session'
		});

		await expect(transport.killSession(handle)).resolves.toEqual({
			dead: false,
			exitCode: null
		});
		expect(activePty?.killCount).toBeGreaterThanOrEqual(2);
		expect(processGroupSignals).toContain('group:SIGTERM');
		expect(processGroupSignals).toContain('group:SIGKILL');
		expect(await transport.readPaneState(handle)).toEqual({
			dead: false,
			exitCode: null
		});
	});

	it('marks snapshots as truncated when scrollback exceeds the buffer limit', async () => {
		let activePty: FakePty | undefined;
		const transport = new TerminalAgentTransport({
			spawn: (() => {
				activePty = createFakePty();
				return activePty;
			}) as never
		});

		const handle = await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			sessionName: 'truncated-session'
		});
		activePty?.emitData('a'.repeat(210_000));

		const snapshot = await transport.readSnapshot(handle);
		expect(snapshot.truncated).toBe(true);
		expect(snapshot.screen).toHaveLength(200_000);
	});

	it('resolves commands from the provided PATH before spawning the PTY', async () => {
		const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-pty-path-'));
		const binaryPath = path.join(runtimeDirectory, 'custom-cli');
		await fs.writeFile(binaryPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });

		let spawnedCommand = '';
		let spawnedArgs: string[] = [];
		const transport = new TerminalAgentTransport({
			spawn: ((command: string, args: string[]) => {
				spawnedCommand = command;
				spawnedArgs = [...args];
				return createFakePty();
			}) as never
		});

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'custom-cli',
			env: { PATH: runtimeDirectory },
			sessionName: 'path-resolution-session'
		});

		expect(spawnedCommand).toBe('/bin/sh');
		expect(spawnedArgs).toEqual([binaryPath]);
	});

	it('resolves a Copilot CLI binary even when PATH does not include it', async () => {
		const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-pty-home-'));
		const copilotDirectory = path.join(
			homeDirectory,
			'Library',
			'Application Support',
			'Code - Insiders',
			'User',
			'globalStorage',
			'github.copilot-chat',
			'copilotCli'
		);
		const copilotPath = path.join(copilotDirectory, 'copilot');
		await fs.mkdir(copilotDirectory, { recursive: true });
		await fs.writeFile(copilotPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });

		let spawnedCommand = '';
		let spawnedArgs: string[] = [];
		const transport = new TerminalAgentTransport({
			spawn: ((command: string, args: string[]) => {
				spawnedCommand = command;
				spawnedArgs = [...args];
				return createFakePty();
			}) as never
		});

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: 'copilot',
			env: { HOME: homeDirectory, PATH: '/usr/bin:/bin' },
			sessionName: 'copilot-resolution-session'
		});

		expect(path.basename(spawnedCommand)).toBe('node');
		expect(path.basename(spawnedArgs[0] ?? '')).toBe('copilot');
	});

	it('launches shebang scripts through their interpreter when the resolved executable is a script', async () => {
		const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-pty-script-'));
		const scriptDirectory = path.join(runtimeDirectory, 'Application Support', 'copilotCli');
		const scriptPath = path.join(scriptDirectory, 'copilot');
		await fs.mkdir(scriptDirectory, { recursive: true });
		await fs.writeFile(scriptPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });

		let spawnedCommand = '';
		let spawnedArgs: string[] = [];
		const transport = new TerminalAgentTransport({
			spawn: ((command: string, args: string[]) => {
				spawnedCommand = command;
				spawnedArgs = [...args];
				return createFakePty();
			}) as never
		});

		await transport.openSession({
			workingDirectory: '/tmp/work',
			command: scriptPath,
			args: ['--version'],
			sessionName: 'script-launch-session'
		});

		expect(spawnedCommand).toBe('/bin/sh');
		expect(spawnedArgs).toEqual([scriptPath, '--version']);
	});
});

function createFakePty(pid = 1): FakePty {
	let onDataListener: ((chunk: string) => void) | undefined;
	let onExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
	const fakePty = {
		pid,
		process: 'fake-shell',
		cols: 120,
		rows: 32,
		handleFlowControl: false,
		write(data: string) {
			fakePty.writes.push(data);
		},
		resize(cols: number, rows: number) {
			fakePty.cols = cols;
			fakePty.rows = rows;
			fakePty.resizes.push({ cols, rows });
		},
		kill() {
			fakePty.killCount += 1;
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
		emitData(chunk: string) {
			onDataListener?.(chunk);
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
		off() {
			return fakePty;
		},
		emit() {
			return true;
		},
		removeAllListeners() {
			return fakePty;
		},
		once() {
			return fakePty;
		},
		listeners() {
			return [];
		},
		rawListeners() {
			return [];
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
		},
		writes: [] as string[],
		resizes: [] as Array<{ cols: number; rows: number }>,
		killCount: 0
	};

	return fakePty as unknown as FakePty;
}
