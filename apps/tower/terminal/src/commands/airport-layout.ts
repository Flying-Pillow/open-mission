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
	const editorCommand = buildEditorCommand(repoRoot);
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
	const render = (snapshot: Awaited<ReturnType<typeof api.airport.getStatus>>) => {
		printAgentSessionHeader('MISSION AGENT SESSION PANE');
		const binding = snapshot.state.airport.gates.agentSession;
		process.stdout.write(`airport: ${snapshot.state.airport.airportId}\n`);
		process.stdout.write(`session: ${snapshot.state.airport.substrate.sessionName}\n`);
		process.stdout.write(`binding: ${binding.targetKind}${binding.targetId ? `:${binding.targetId}` : ''}${binding.mode ? ` (${binding.mode})` : ''}\n`);
		process.stdout.write(`focus intent: ${snapshot.state.airport.focus.intentGateId ?? 'none'}\n`);
		process.stdout.write(`focus observed: ${snapshot.state.airport.focus.observedGateId ?? 'none'}\n`);
		process.stdout.write('\n');
		if (binding.targetKind === 'agentSession' && binding.targetId) {
			process.stdout.write(`Agent session gate is bound to agent session ${binding.targetId}.\n`);
			process.stdout.write('Airport will surface the session in this gate when the substrate observes it.\n');
			return;
		}
		process.stdout.write('Agent session gate is idle.\n');
		process.stdout.write('Airport owns the agent session gate binding and terminal-manager reconciliation.\n');
	};

	const initialSnapshot = await api.airport.connectPanel({
		gateId: 'agentSession',
		label: 'mission-agent-session',
		panelProcessId: String(process.pid),
		...(process.env['MISSION_TERMINAL_SESSION']?.trim()
			? { terminalSessionName: process.env['MISSION_TERMINAL_SESSION'].trim() }
			: {})
	});
	render(initialSnapshot);

	const subscription = client.onDidEvent((event) => {
		if (event.type === 'airport.state') {
			render(event.snapshot);
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
	const editorCommand = buildEditorCommand(process.cwd());
	const child = spawn('sh', ['-lc', `exec ${editorCommand}`], {
		cwd: process.cwd(),
		stdio: 'inherit',
		env: process.env
	});

	await new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal === 'SIGTERM') {
				resolve();
				return;
			}
			if (signal) {
				reject(new Error(`editor exited from signal ${signal}.`));
				return;
			}
			if ((code ?? 0) !== 0) {
				reject(new Error(`editor exited with code ${String(code ?? 1)}.`));
				return;
			}
			resolve();
		});
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

function buildEditorCommand(repoRoot: string): string {
	const explicitEditorCommand = process.env['MISSION_TERMINAL_EDITOR_COMMAND']?.trim()
		|| process.env['MISSION_EDITOR_COMMAND']?.trim();
	if (explicitEditorCommand) {
		return explicitEditorCommand;
	}

	const editorTarget = [
		path.join(repoRoot, 'mission.json'),
		path.join(repoRoot, 'README.md'),
		path.join(repoRoot, 'BRANCH_HANDOFF.md'),
		path.join(repoRoot, 'CHANGELOG.md')
	].find((candidate) => existsSync(candidate));

	return editorTarget ? buildShellCommand(['micro', editorTarget]) : buildShellCommand(['micro']);
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

function printAgentSessionHeader(title: string): void {
	process.stdout.write('\u001b[H\u001b[2J\u001b[3J');
	process.stdout.write(`${title}\n\n`);
}
