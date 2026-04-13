import { execFile, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	connectAirportControl,
	readMissionUserConfig,
	resolveAirportControlRuntimeMode
} from '@flying-pillow/mission-core';
import type { AirportTerminalContext } from '../airportTerminalContext.js';
import { buildAirportBootstrapLayout } from './airportLayoutDefinition.js';

const execFileAsync = promisify(execFile);
const defaultAirportTerminalSessionName = 'flying-pillow-mission | AIRPORT';

export async function bootstrapAirportLayout(context: AirportTerminalContext): Promise<void> {
	const sessionName = resolveTerminalManagerSessionName();
	const terminalManagerBinary = resolveTerminalManagerBinary();
	const runtimeRoot = resolveRuntimeRoot();
	const sessionSlug = slugifySessionName(sessionName);
	const runtimeConfigRoot = path.join(runtimeRoot, 'mission', `runtime-${sessionSlug}`);
	const terminalManagerConfigDir = path.join(runtimeConfigRoot, 'terminal-manager');
	const layoutFile = path.join(runtimeRoot, 'mission', `airport-layout-${sessionSlug}.kdl`);
	const repoRoot = context.controlRoot;
	const missionEntryCommand = resolveMissionEntryCommand();
	const airportTerminalEntryPath = missionEntryCommand[missionEntryCommand.length - 1] ?? '';
	const towerCommand = buildShellCommand([
		'env',
		'AIRPORT_TERMINAL_ACTIVE=1',
		'AIRPORT_PANE_ID=tower',
		`AIRPORT_TERMINAL_SESSION=${sessionName}`,
		`AIRPORT_TERMINAL_ENTRY_PATH=${airportTerminalEntryPath}`,
		...missionEntryCommand,
		...context.args
	]);
	const briefingRoomCommand = buildShellCommand([
		'env',
		'AIRPORT_PANE_ID=briefingRoom',
		`AIRPORT_TERMINAL_SESSION=${sessionName}`,
		`AIRPORT_TERMINAL_ENTRY_PATH=${airportTerminalEntryPath}`,
		...missionEntryCommand,
		'__airport-layout-briefing-room-pane'
	]);
	const viewportColumns = resolveViewportColumns();
	const layoutInput = {
		repoRoot,
		towerCommand,
		briefingRoomCommand,
		...(viewportColumns === undefined ? {} : { viewportColumns })
	};

	await mkdir(terminalManagerConfigDir, { recursive: true });
	await mkdir(path.dirname(layoutFile), { recursive: true });
	await writeFile(path.join(terminalManagerConfigDir, 'config.kdl'), buildTerminalManagerConfig(), 'utf8');
	await writeFile(layoutFile, buildAirportBootstrapLayout(layoutInput), 'utf8');

	const daemonClient = await connectAirportControl({
		surfacePath: repoRoot,
		runtimeMode: resolveAirportControlRuntimeMode(import.meta.url),
		allowStart: true
	});
	daemonClient.dispose();

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

function resolveTerminalManagerSessionName(): string {
	return process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim()
		|| defaultAirportTerminalSessionName;
}

function slugifySessionName(sessionName: string): string {
	return sessionName.replace(/[^A-Za-z0-9._-]+/gu, '_');
}

function resolveRuntimeRoot(): string {
	return process.env['XDG_RUNTIME_DIR']?.trim() || process.env['TMPDIR']?.trim() || os.tmpdir();
}

function resolveViewportColumns(): number | undefined {
	const envColumns = process.env['COLUMNS']?.trim();
	if (envColumns) {
		const parsedColumns = Number.parseInt(envColumns, 10);
		if (Number.isFinite(parsedColumns) && parsedColumns > 0) {
			return parsedColumns;
		}
	}

	const stdoutColumns = process.stdout.columns;
	return typeof stdoutColumns === 'number' && Number.isFinite(stdoutColumns) && stdoutColumns > 0
		? stdoutColumns
		: undefined;
}

function resolveMissionEntryCommand(): string[] {
	const entryScriptPath = process.argv[1]?.trim();
	if (!entryScriptPath) {
		throw new Error('Airport terminal entry path is unavailable for airport layout bootstrap.');
	}
	return resolveAirportRuntimeCommand(entryScriptPath);
}

export function resolveAirportRuntimeCommand(entryScriptPath: string): string[] {
	if (process.versions['bun']) {
		return [process.execPath, entryScriptPath];
	}
	return [readMissionUserConfig()?.bunBinary?.trim() || 'bun', entryScriptPath];
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
			`Unable to reset terminal-manager session '${normalizedSessionName}' before opening the airport layout (${lingeringSession.state}).`
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

function buildShellCommand(args: string[]): string {
	return args.map(shellEscape).join(' ');
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function buildTerminalManagerConfig(): string {
	return `themes {
    tower {
        bg "#0F1419"
        fg "#555555"
		green "#FFFFFF"
        black "#000000"
        red "#FF3333"
        yellow "#E5C07B"
        blue "#61AFEF"
        magenta "#C678DD"
        cyan "#56B6C2"
        white "#FFFFFF"
        orange "#D19A66"

		frame_unselected {
			base 85 85 85
			background 15 20 25
			emphasis_0 255 255 255
			emphasis_1 255 255 255
			emphasis_2 255 255 255
			emphasis_3 255 255 255
		}
		frame_selected {
			base 255 255 255
			background 15 20 25
			emphasis_0 255 255 255
			emphasis_1 255 255 255
			emphasis_2 255 255 255
			emphasis_3 255 255 255
		}
		frame_highlight {
			base 255 255 255
			background 15 20 25
			emphasis_0 255 255 255
			emphasis_1 255 255 255
			emphasis_2 255 255 255
			emphasis_3 255 255 255
		}
    }
}

theme "tower"
show_startup_tips false

keybinds {
	shared_except "locked" {
		bind "Alt Right" "Alt l" { FocusNextPane; }
		bind "Alt Left" "Alt h" { FocusPreviousPane; }
	}
}

ui {
    pane_frames {
        rounded_corners true
    }
}
`;
}

function resolveTerminalManagerBinary(): string {
	return process.env['AIRPORT_TERMINAL_BINARY']?.trim()
		|| readMissionUserConfig()?.terminalBinary?.trim()
		|| 'zellij';
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

export function parseTerminalManagerSessionSummary(line: string): TerminalManagerSessionSummary | undefined {
	const name = parseTerminalManagerSessionName(line);
	if (!name) {
		return undefined;
	}
	return {
		name,
		state: line.includes('(EXITED') ? 'exited' : 'live'
	};
}

export function parseTerminalManagerSessionName(line: string): string | undefined {
	const normalizedLine = line.trim();
	if (!normalizedLine) {
		return undefined;
	}
	const withoutExitedSuffix = normalizedLine.replace(/\s+\(EXITED[^)]*\)\s*$/u, '');
	const withoutCreatedSuffix = withoutExitedSuffix.replace(/\s+\[[^\]]*\]\s*$/u, '');
	return withoutCreatedSuffix.trim() || undefined;
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