import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DaemonApi } from '@flying-pillow/mission-core';
import { connectSurfaceDaemon, resolveSurfaceDaemonLaunchMode } from '../daemon/connectSurfaceDaemon.js';
import type { CommandContext } from './types.js';

const execFileAsync = promisify(execFile);

type AirportLayoutSnapshot = Awaited<ReturnType<DaemonApi['airport']['getStatus']>>;
type AirportLayoutSessionRecord = Awaited<ReturnType<DaemonApi['mission']['listSessions']>>[number];
type AirportLayoutConsoleState = Awaited<ReturnType<DaemonApi['mission']['getSessionConsoleState']>>;

export async function runAirportLayoutLaunch(context: CommandContext): Promise<void> {
	const sessionName = resolveTerminalManagerSessionName(context.controlRoot);
	const terminalManagerBinary = resolveTerminalManagerBinary();
	const runtimeRoot = resolveRuntimeRoot();
	const sessionSlug = slugifySessionName(sessionName);
	const runtimeConfigRoot = path.join(runtimeRoot, 'mission', `runtime-${sessionSlug}`);
	const terminalManagerConfigDir = path.join(runtimeConfigRoot, 'terminal-manager');
	const layoutFile = path.join(runtimeRoot, 'mission', `airport-layout-${sessionSlug}.kdl`);
	const rightWidth = process.env['MISSION_TERMINAL_RIGHT_COLUMN_WIDTH']?.trim()
		|| process.env['MISSION_TERMINAL_OPERATOR_PANE_SIZE']?.trim()
		|| '50%';
	const editorHeight = process.env['MISSION_TERMINAL_EDITOR_HEIGHT']?.trim() || '35%';
	const repoRoot = context.controlRoot;
	const missionEntry = path.join(repoRoot, 'mission');
	const towerCommand = buildShellCommand([
		'env',
		'MISSION_TERMINAL_ACTIVE=1',
		'MISSION_GATE_ID=dashboard',
		`MISSION_TERMINAL_SESSION=${sessionName}`,
		missionEntry,
		...context.args
	]);
	const agentSessionCommand = buildShellCommand([
		'env',
		'MISSION_GATE_ID=agentSession',
		`MISSION_TERMINAL_SESSION=${sessionName}`,
		missionEntry,
		'__airport-layout-agent-session-pane'
	]);
	const editorCommand = buildShellCommand([
		'env',
		'MISSION_GATE_ID=editor',
		`MISSION_TERMINAL_SESSION=${sessionName}`,
		missionEntry,
		'__airport-layout-editor-pane'
	]);

	await mkdir(terminalManagerConfigDir, { recursive: true });
	await mkdir(path.dirname(layoutFile), { recursive: true });
	await writeFile(path.join(terminalManagerConfigDir, 'config.kdl'), buildTerminalManagerConfig(), 'utf8');
	await writeFile(layoutFile, buildAirportLayout({
		repoRoot,
		towerCommand,
		agentSessionCommand,
		editorCommand,
		rightWidth,
		editorHeight
	}), 'utf8');

	await resetTerminalManagerSession(terminalManagerBinary, sessionName);

	const child = spawn(
		terminalManagerBinary,
		['--config-dir', terminalManagerConfigDir, '--session', sessionName, '--new-session-with-layout', layoutFile],
		{
			stdio: 'inherit',
			env: process.env
		}
	);

	await new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) {
				reject(new Error(`terminal manager exited from signal ${signal}.`));
				return;
			}
			if ((code ?? 0) !== 0) {
				reject(new Error(`terminal manager exited with code ${String(code ?? 1)}.`));
				return;
			}
			resolve();
		});
	});
}

export async function runAirportLayoutAgentSessionPane(_context: CommandContext): Promise<void> {
	const client = await connectSurfaceDaemon({
		surfacePath: process.cwd(),
		launchMode: resolveSurfaceDaemonLaunchMode(import.meta.url)
	});
	const api = new DaemonApi(client);
	let currentSnapshot = await api.airport.connectPanel({
		gateId: 'agentSession',
		label: 'mission-agent-session',
		panelProcessId: String(process.pid),
		...(process.env['MISSION_TERMINAL_SESSION']?.trim()
			? { terminalSessionName: process.env['MISSION_TERMINAL_SESSION'].trim() }
			: {})
	});
	let currentSession: AirportLayoutSessionRecord | undefined;
	let currentConsoleState: AirportLayoutConsoleState = null;
	let refreshNonce = 0;

	const render = () => {
		renderAgentSessionPane({
			snapshot: currentSnapshot,
			session: currentSession,
			consoleState: currentConsoleState
		});
	};

	const refreshSessionSurface = async (snapshot: AirportLayoutSnapshot): Promise<void> => {
		const refreshId = ++refreshNonce;
		const target = resolveAgentSessionTarget(snapshot);
		if (!target.sessionId || !target.missionId) {
			currentSession = undefined;
			currentConsoleState = null;
			render();
			return;
		}

		const selector = { missionId: target.missionId };
		const sessions = await api.mission.listSessions(selector);
		const nextSession = sessions.find((candidate) => candidate.sessionId === target.sessionId);
		const nextConsoleState = nextSession
			? await api.mission.getSessionConsoleState(selector, target.sessionId)
			: null;

		if (refreshId !== refreshNonce) {
			return;
		}

		currentSession = nextSession;
		currentConsoleState = nextConsoleState;
		render();
	};

	await refreshSessionSurface(currentSnapshot);

	const subscription = client.onDidEvent((event) => {
		if (event.type === 'airport.state') {
			currentSnapshot = event.snapshot;
			void refreshSessionSurface(currentSnapshot).catch((error: unknown) => {
				process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
				process.exitCode = 1;
			});
			return;
		}

		if (event.type === 'mission.status') {
			const target = resolveAgentSessionTarget(currentSnapshot);
			if (!target.sessionId || event.missionId !== target.missionId) {
				return;
			}
			currentSession = event.status.agentSessions?.find((candidate) => candidate.sessionId === target.sessionId);
			if (!currentSession) {
				currentConsoleState = null;
			}
			render();
			return;
		}

		if (event.type === 'session.console' && event.sessionId === currentSession?.sessionId) {
			currentConsoleState = event.event.state;
			render();
			return;
		}

		if (event.type === 'session.event' && event.sessionId === currentSession?.sessionId) {
			currentSession = {
				...currentSession,
				...pickSessionRecordUpdates(event.event.state)
			};
			render();
			return;
		}

		if (event.type === 'session.lifecycle' && event.sessionId === currentSession?.sessionId) {
			currentSession = {
				...currentSession,
				lifecycleState: event.lifecycleState
			};
			render();
		}
	});

	await new Promise<void>((resolve) => {
		const dispose = () => {
			subscription.dispose();
			client.dispose();
			resolve();
		};
		process.once('SIGINT', dispose);
		process.once('SIGTERM', dispose);
	});
}

export async function runAirportLayoutEditorPane(_context: CommandContext): Promise<void> {
	const client = await connectSurfaceDaemon({
		surfacePath: process.cwd(),
		launchMode: resolveSurfaceDaemonLaunchMode(import.meta.url)
	});
	const api = new DaemonApi(client);
	let activeChild: ReturnType<typeof spawn> | undefined;
	let activeLaunchPath: string | undefined;
	let shuttingDown = false;
	let restartingChild = false;

	const launchEditor = async (snapshot: Awaited<ReturnType<typeof api.airport.getStatus>>): Promise<void> => {
		const nextLaunchPath = resolveEditorLaunchPath(snapshot, process.cwd());
		if (activeChild && activeLaunchPath === nextLaunchPath) {
			return;
		}
		if (activeChild) {
			restartingChild = true;
			activeChild.kill('SIGTERM');
			return;
		}
		activeLaunchPath = nextLaunchPath;
		const editorCommand = buildEditorCommand(process.cwd(), nextLaunchPath);
		activeChild = spawn('sh', ['-lc', `exec ${editorCommand}`], {
			cwd: process.cwd(),
			stdio: 'inherit',
			env: process.env
		});
		activeChild.once('error', (error) => {
			if (!shuttingDown) {
				throw error;
			}
		});
		activeChild.once('exit', (code, signal) => {
			activeChild = undefined;
			if (restartingChild) {
				restartingChild = false;
				void launchEditor(snapshotFromCurrentState).catch((error: unknown) => {
					process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
					process.exitCode = 1;
				});
				return;
			}
			if (shuttingDown || signal === 'SIGTERM') {
				return;
			}
			if (signal) {
				process.stderr.write(`editor exited from signal ${signal}.\n`);
				process.exitCode = 1;
				return;
			}
			if ((code ?? 0) !== 0) {
				process.stderr.write(`editor exited with code ${String(code ?? 1)}.\n`);
				process.exitCode = code ?? 1;
			}
		});
	};

	let snapshotFromCurrentState = await api.airport.connectPanel({
		gateId: 'editor',
		label: 'mission-editor',
		panelProcessId: String(process.pid),
		...(process.env['MISSION_TERMINAL_SESSION']?.trim()
			? { terminalSessionName: process.env['MISSION_TERMINAL_SESSION'].trim() }
			: {})
	});
	await launchEditor(snapshotFromCurrentState);

	const subscription = client.onDidEvent((event) => {
		if (event.type !== 'airport.state') {
			return;
		}
		snapshotFromCurrentState = event.snapshot;
		void launchEditor(snapshotFromCurrentState).catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
	});

	await new Promise<void>((resolve) => {
		const dispose = () => {
			shuttingDown = true;
			subscription.dispose();
			client.dispose();
			if (activeChild) {
				activeChild.once('exit', () => resolve());
				activeChild.kill('SIGTERM');
				return;
			}
			resolve();
		};
		process.once('SIGINT', dispose);
		process.once('SIGTERM', dispose);
	});
}

function resolveTerminalManagerSessionName(controlRoot: string): string {
	return process.env['MISSION_TERMINAL_SESSION']?.trim()
		|| process.env['MISSION_TERMINAL_SESSION_NAME']?.trim()
		|| `mission-${path.basename(controlRoot)}`;
}

function slugifySessionName(sessionName: string): string {
	return sessionName.replace(/[^A-Za-z0-9._-]+/gu, '_');
}

function resolveRuntimeRoot(): string {
	return process.env['XDG_RUNTIME_DIR']?.trim() || process.env['TMPDIR']?.trim() || os.tmpdir();
}

async function resetTerminalManagerSession(terminalManagerBinary: string, sessionName: string): Promise<void> {
	const normalizedSessionName = sessionName.trim();
	if (!normalizedSessionName) {
		throw new Error('Terminal-manager session name is required.');
	}

	const existingSession = (await listTerminalManagerSessions(terminalManagerBinary))
		.find((session) => session.name === normalizedSessionName);
	if (!existingSession) {
		return;
	}

	await execTerminalManager(terminalManagerBinary, ['delete-session', '--force', normalizedSessionName]);

	const lingeringSession = await waitForSessionToDisappear(terminalManagerBinary, normalizedSessionName);
	if (lingeringSession) {
		throw new Error(
			`Unable to reset terminal-manager session '${normalizedSessionName}' before launch (${lingeringSession.state}).`
		);
	}
}

async function waitForSessionToDisappear(
	terminalManagerBinary: string,
	sessionName: string
): Promise<TerminalManagerSessionSummary | undefined> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const lingeringSession = (await listTerminalManagerSessions(terminalManagerBinary))
			.find((session) => session.name === sessionName);
		if (!lingeringSession) {
			return undefined;
		}
		await delay(100);
	}

	return (await listTerminalManagerSessions(terminalManagerBinary))
		.find((session) => session.name === sessionName);
}

function buildEditorCommand(repoRoot: string, launchPath?: string): string {
	const explicitEditorCommand = process.env['MISSION_TERMINAL_EDITOR_COMMAND']?.trim()
		|| process.env['MISSION_EDITOR_COMMAND']?.trim();
	if (explicitEditorCommand) {
		return explicitEditorCommand;
	}

	const editorTarget = launchPath?.trim()
		|| [
			path.join(repoRoot, 'mission.json'),
			path.join(repoRoot, 'README.md'),
			path.join(repoRoot, 'BRANCH_HANDOFF.md'),
			path.join(repoRoot, 'CHANGELOG.md')
		].find((candidate) => existsSync(candidate));

	return editorTarget ? buildShellCommand(['micro', editorTarget]) : buildShellCommand(['micro']);
}

function resolveEditorLaunchPath(
	snapshot: Awaited<ReturnType<DaemonApi['airport']['getStatus']>>,
	fallbackPath: string
): string {
	return snapshot.airportProjections.editor.launchPath?.trim() || fallbackPath;
}

function buildShellCommand(args: string[]): string {
	return args.map(shellEscape).join(' ');
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function buildTerminalManagerConfig(): string {
	return `themes {
    tower {
        bg "#0F1419"
        fg "#555555"
        green "#1E40AF"
        black "#000000"
        red "#FF3333"
        yellow "#E5C07B"
        blue "#61AFEF"
        magenta "#C678DD"
        cyan "#56B6C2"
        white "#FFFFFF"
        orange "#D19A66"
    }
}

theme "tower"
show_startup_tips false

ui {
    pane_frames {
        rounded_corners true
    }
}
`;
}

function buildAirportLayout(input: {
	repoRoot: string;
	towerCommand: string;
	agentSessionCommand: string;
	editorCommand: string;
	rightWidth: string;
	editorHeight: string;
}): string {
	return `layout {
	default_tab_template {
		children
	}
	tab name="TOWER" {
		pane split_direction="vertical" {
			pane name="MISSION" focus=true command="sh" cwd="${kdlEscape(input.repoRoot)}" {
				args "-lc" "${kdlEscape(`exec ${input.towerCommand}`)}"
			}
			pane size="${kdlEscape(input.rightWidth)}" split_direction="horizontal" {
				pane name="AGENT SESSION" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
					args "-lc" "${kdlEscape(`exec ${input.agentSessionCommand}`)}"
				}
				pane size="${kdlEscape(input.editorHeight)}" name="EDITOR" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
					args "-lc" "${kdlEscape(`exec ${input.editorCommand}`)}"
				}
			}
		}
	}
}
`;
}

function kdlEscape(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function resolveTerminalManagerBinary(): string {
	return process.env['MISSION_TERMINAL_BINARY']?.trim() || 'zellij';
}

type TerminalManagerSessionState = 'live' | 'exited';

type TerminalManagerSessionSummary = {
	name: string;
	state: TerminalManagerSessionState;
};

async function listTerminalManagerSessions(terminalManagerBinary: string): Promise<TerminalManagerSessionSummary[]> {
	const result = await execTerminalManager(terminalManagerBinary, ['list-sessions']);
	return result.stdout
		.split(/\r?\n/gu)
		.map((line) => stripAnsi(line).trim())
		.filter((line) => line.length > 0)
		.map(parseTerminalManagerSessionSummary)
		.filter((session): session is TerminalManagerSessionSummary => session !== undefined);
}

function parseTerminalManagerSessionSummary(line: string): TerminalManagerSessionSummary | undefined {
	const name = line.match(/^(\S+)/u)?.[1];
	if (!name) {
		return undefined;
	}
	return {
		name,
		state: line.includes('(EXITED') ? 'exited' : 'live'
	};
}

async function execTerminalManager(terminalManagerBinary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	const result = await execFileAsync(terminalManagerBinary, args, {
		encoding: 'utf8',
		env: { ...process.env, ZELLIJ: undefined }
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr
	};
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

function stripAnsi(value: string): string {
	let output = '';
	for (let index = 0; index < value.length; index += 1) {
		if (value.charCodeAt(index) !== 27) {
			output += value[index] ?? '';
			continue;
		}
		if (value[index + 1] !== '[') {
			continue;
		}
		index += 2;
		while (index < value.length && /[0-9;]/u.test(value[index] ?? '')) {
			index += 1;
		}
		if (index < value.length && value[index] !== 'm') {
			index -= 1;
		}
	}
	return output;
}

function resolveAgentSessionTarget(snapshot: AirportLayoutSnapshot): {
	missionId?: string;
	sessionId?: string;
} {
	const projection = snapshot.airportProjections.agentSession;
	const missionId = projection.missionId;
	const sessionId = projection.sessionId;
	return {
		...(missionId ? { missionId } : {}),
		...(sessionId ? { sessionId } : {})
	};
}

function renderAgentSessionPane(input: {
	snapshot: AirportLayoutSnapshot;
	session: AirportLayoutSessionRecord | undefined;
	consoleState: AirportLayoutConsoleState;
}): void {
	printAgentSessionHeader('MISSION AGENT SESSION PANE');
	const binding = input.snapshot.state.airport.gates.agentSession;
	const projection = input.snapshot.airportProjections.agentSession;
	process.stdout.write(`airport: ${input.snapshot.state.airport.airportId}\n`);
	process.stdout.write(`session: ${input.snapshot.state.airport.substrate.sessionName}\n`);
	process.stdout.write(`binding: ${binding.targetKind}${binding.targetId ? `:${binding.targetId}` : ''}${binding.mode ? ` (${binding.mode})` : ''}\n`);
	process.stdout.write(`focus intent: ${input.snapshot.state.airport.focus.intentGateId ?? 'none'}\n`);
	process.stdout.write(`focus observed: ${input.snapshot.state.airport.focus.observedGateId ?? 'none'}\n`);
	process.stdout.write('\n');

	if (!projection.sessionId) {
		process.stdout.write('Agent session gate is idle.\n');
		process.stdout.write('Select or launch a task session from Tower to bind this pane.\n');
		return;
	}

	process.stdout.write(`agent session: ${projection.sessionId}\n`);
	process.stdout.write(`mission: ${projection.missionId ?? 'unknown'}\n`);
	process.stdout.write(`status: ${input.session?.lifecycleState ?? projection.statusLabel}\n`);
	if (input.session?.runtimeLabel) {
		process.stdout.write(`runtime: ${input.session.runtimeLabel}\n`);
	}
	if (input.session?.taskId) {
		process.stdout.write(`task: ${input.session.taskId}\n`);
	}
	if (input.session?.workingDirectory) {
		process.stdout.write(`cwd: ${input.session.workingDirectory}\n`);
	}
	process.stdout.write('\n');

	const consoleLines = input.consoleState?.lines ?? [];
	const visibleLineCount = Math.max((process.stdout.rows ?? 24) - 14, 8);
	const visibleLines = consoleLines.slice(-visibleLineCount);
	if (visibleLines.length === 0) {
		if (input.session?.transportId === 'terminal') {
			process.stdout.write('Terminal-backed session is bound. The live Copilot pane should replace this slot.\n');
		} else {
			process.stdout.write('Waiting for session output.\n');
		}
	} else {
		for (const line of visibleLines) {
			process.stdout.write(`${line}\n`);
		}
	}

	if (input.consoleState?.awaitingInput) {
		process.stdout.write('\nAwaiting input in the bound agent session. Use Tower session controls to continue.\n');
	}
	if (input.consoleState?.promptOptions && input.consoleState.promptOptions.length > 0) {
		process.stdout.write(`Prompt options: ${input.consoleState.promptOptions.join(', ')}\n`);
	}
	if (!input.session && !input.consoleState) {
		process.stdout.write('\nWaiting for mission runtime to surface the bound session.\n');
	}
}

function pickSessionRecordUpdates(state: {
	runtimeId: string;
	transportId?: string;
	runtimeLabel: string;
	sessionId: string;
	lifecycleState: string;
	workingDirectory?: string;
	currentTurnTitle?: string;
	failureMessage?: string;
	lastUpdatedAt: string;
}): Partial<AirportLayoutSessionRecord> {
	return {
		runtimeId: state.runtimeId,
		...(state.transportId ? { transportId: state.transportId } : {}),
		runtimeLabel: state.runtimeLabel,
		lifecycleState: state.lifecycleState as AirportLayoutSessionRecord['lifecycleState'],
		...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
		...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
		...(state.failureMessage ? { failureMessage: state.failureMessage } : {}),
		lastUpdatedAt: state.lastUpdatedAt
	};
}

function printAgentSessionHeader(title: string): void {
	process.stdout.write('\u001b[H\u001b[2J\u001b[3J');
	process.stdout.write(`${title}\n\n`);
}
