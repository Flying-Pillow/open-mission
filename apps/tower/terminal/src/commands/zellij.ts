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

export async function runZellijLaunch(context: CommandContext): Promise<void> {
	const sessionName = resolveZellijSessionName(context.controlRoot);
	const zellijBinary = resolveZellijBinary();
	const runtimeRoot = resolveRuntimeRoot();
	const sessionSlug = slugifySessionName(sessionName);
	const runtimeConfigRoot = path.join(runtimeRoot, 'mission', `runtime-${sessionSlug}`);
	const zellijConfigDir = path.join(runtimeConfigRoot, 'zellij');
	const layoutFile = path.join(runtimeRoot, 'mission', `tower-${sessionSlug}.kdl`);
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
	const pilotCommand = buildShellCommand([
		'env',
		'MISSION_GATE_ID=pilot',
		`MISSION_TERMINAL_SESSION=${sessionName}`,
		missionEntry,
		'__pilot-pane'
	]);

	await mkdir(zellijConfigDir, { recursive: true });
	await mkdir(path.dirname(layoutFile), { recursive: true });
	await writeFile(path.join(zellijConfigDir, 'config.kdl'), buildZellijConfig(), 'utf8');
	await writeFile(layoutFile, buildZellijLayout({
		repoRoot,
		towerCommand,
		pilotCommand,
		editorCommand,
		rightWidth,
		editorHeight
	}), 'utf8');

	await resetZellijSession(zellijBinary, sessionName);

	const child = spawn(
		zellijBinary,
		['--config-dir', zellijConfigDir, '--session', sessionName, '--new-session-with-layout', layoutFile],
		{
			stdio: 'inherit',
			env: process.env
		}
	);

	await new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) {
				reject(new Error(`zellij exited from signal ${signal}.`));
				return;
			}
			if ((code ?? 0) !== 0) {
				reject(new Error(`zellij exited with code ${String(code ?? 1)}.`));
				return;
			}
			resolve();
		});
	});
}

export async function runZellijPilotPane(_context: CommandContext): Promise<void> {
	const client = await connectSurfaceDaemon({
		surfacePath: process.cwd(),
		launchMode: resolveSurfaceDaemonLaunchMode(import.meta.url)
	});
	const api = new DaemonApi(client);
	const render = (snapshot: Awaited<ReturnType<typeof api.airport.getStatus>>) => {
		printPilotHeader('MISSION PILOT PANE');
		const binding = snapshot.state.airport.gates.pilot;
		process.stdout.write(`airport: ${snapshot.state.airport.airportId}\n`);
		process.stdout.write(`session: ${snapshot.state.airport.substrate.sessionName}\n`);
		process.stdout.write(`binding: ${binding.targetKind}${binding.targetId ? `:${binding.targetId}` : ''}${binding.mode ? ` (${binding.mode})` : ''}\n`);
		process.stdout.write(`focus intent: ${snapshot.state.airport.focus.intentGateId ?? 'none'}\n`);
		process.stdout.write(`focus observed: ${snapshot.state.airport.focus.observedGateId ?? 'none'}\n`);
		process.stdout.write('\n');
		if (binding.targetKind === 'agentSession' && binding.targetId) {
			process.stdout.write(`Pilot is bound to agent session ${binding.targetId}.\n`);
			process.stdout.write('Airport will surface the session in this gate when the substrate observes it.\n');
			return;
		}
		process.stdout.write('Pilot gate is idle.\n');
		process.stdout.write('Airport owns the pilot gate binding and zellij reconciliation.\n');
	};

	const initialSnapshot = await api.airport.connectPanel({
		gateId: 'pilot',
		label: 'mission-pilot',
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

export async function runZellijEditorPane(_context: CommandContext): Promise<void> {
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

function resolveZellijSessionName(controlRoot: string): string {
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

async function resetZellijSession(zellijBinary: string, sessionName: string): Promise<void> {
	const normalizedSessionName = sessionName.trim();
	if (!normalizedSessionName) {
		throw new Error('Zellij session name is required.');
	}

	const existingSession = (await listZellijSessions(zellijBinary))
		.find((session) => session.name === normalizedSessionName);
	if (!existingSession) {
		return;
	}

	await execZellij(zellijBinary, ['delete-session', '--force', normalizedSessionName]);

	const lingeringSession = await waitForSessionToDisappear(zellijBinary, normalizedSessionName);
	if (lingeringSession) {
		throw new Error(
			`Unable to reset zellij session '${normalizedSessionName}' before launch (${lingeringSession.state}).`
		);
	}
}

async function waitForSessionToDisappear(
	zellijBinary: string,
	sessionName: string
): Promise<ZellijSessionSummary | undefined> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const lingeringSession = (await listZellijSessions(zellijBinary))
			.find((session) => session.name === sessionName);
		if (!lingeringSession) {
			return undefined;
		}
		await delay(100);
	}

	return (await listZellijSessions(zellijBinary))
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

function buildZellijConfig(): string {
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

function buildZellijLayout(input: {
	repoRoot: string;
	towerCommand: string;
	pilotCommand: string;
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
				pane name="PILOT" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
					args "-lc" "${kdlEscape(`exec ${input.pilotCommand}`)}"
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

function resolveZellijBinary(): string {
	return process.env['MISSION_TERMINAL_BINARY']?.trim() || 'zellij';
}

type ZellijSessionState = 'live' | 'exited';

type ZellijSessionSummary = {
	name: string;
	state: ZellijSessionState;
};

async function listZellijSessions(zellijBinary: string): Promise<ZellijSessionSummary[]> {
	const result = await execZellij(zellijBinary, ['list-sessions']);
	return result.stdout
		.split(/\r?\n/gu)
		.map((line) => stripAnsi(line).trim())
		.filter((line) => line.length > 0)
		.map(parseZellijSessionSummary)
		.filter((session): session is ZellijSessionSummary => session !== undefined);
}

function parseZellijSessionSummary(line: string): ZellijSessionSummary | undefined {
	const name = line.match(/^(\S+)/u)?.[1];
	if (!name) {
		return undefined;
	}
	return {
		name,
		state: line.includes('(EXITED') ? 'exited' : 'live'
	};
}

async function execZellij(zellijBinary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	const result = await execFileAsync(zellijBinary, args, {
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

function printPilotHeader(title: string): void {
	process.stdout.write('\u001b[H\u001b[2J\u001b[3J');
	process.stdout.write(`${title}\n\n`);
}
