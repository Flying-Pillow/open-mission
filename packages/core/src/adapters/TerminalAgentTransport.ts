import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TerminalExecutorResult = {
	stdout: string;
	stderr: string;
};

export type TerminalExecutor = (args: string[]) => Promise<TerminalExecutorResult>;

export type TerminalSessionHandle = {
	sessionName: string;
	paneId: string;
};

export type TerminalAgentTransportOptions = {
	terminalBinary?: string;
	logLine?: (line: string) => void;
	executor?: TerminalExecutor;
	sharedSessionName?: string;
	pilotPaneTitle?: string;
};

export type TerminalOpenSessionRequest = {
	workingDirectory: string;
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	sessionPrefix?: string;
};

export class TerminalAgentTransport {
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly executor: TerminalExecutor;
	private readonly sharedSessionName: string | undefined;
	private readonly pilotPaneTitle: string;

	public constructor(options: TerminalAgentTransportOptions = {}) {
		this.logLine = options.logLine;
		this.sharedSessionName = options.sharedSessionName?.trim()
			|| process.env['MISSION_TERMINAL_SESSION']?.trim()
			|| process.env['MISSION_TERMINAL_SESSION_NAME']?.trim()
			|| undefined;
		this.pilotPaneTitle = options.pilotPaneTitle?.trim() || 'PILOT';
		const terminalBinary = options.terminalBinary?.trim() || 'zellij';
		this.executor = options.executor ?? (async (args) => {
			const result = await execFileAsync(terminalBinary, args, {
				encoding: 'utf8',
				env: { ...process.env, ZELLIJ: undefined }
			});
			return {
				stdout: result.stdout,
				stderr: result.stderr
			};
		});
	}

	public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
		try {
			const result = await this.runTerminal(['--version']);
			return {
				available: true,
				detail: result.stdout.trim() || 'terminal manager is available.'
			};
		} catch (error) {
			return {
				available: false,
				detail: error instanceof Error ? error.message : String(error)
			};
		}
	}

	public async openSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
		if (this.sharedSessionName) {
			return this.openSharedSession(request);
		}

		return this.openStandaloneSession(request);
	}

	public async attachSession(sessionName: string): Promise<TerminalSessionHandle | undefined> {
		if (this.sharedSessionName) {
			const pane = await this.findPaneByTitle(sessionName);
			if (!pane) {
				return undefined;
			}
			return {
				sessionName,
				paneId: toPaneReference(pane.id)
			};
		}

		const exists = await this.hasSession(sessionName);
		if (!exists) {
			return undefined;
		}
		return {
			sessionName,
			paneId: sessionName
		};
	}

	public async sendKeys(handle: TerminalSessionHandle, keys: string, options: { literal?: boolean } = {}): Promise<void> {
		if (this.sharedSessionName) {
			await this.withPaneFocus(handle.paneId, async () => {
				if (!options.literal && keys === 'Enter') {
					await this.runTerminal(['--session', this.sharedSessionName as string, 'action', 'write', '13']);
					return;
				}
				if (!options.literal && keys === 'C-c') {
					await this.runTerminal(['--session', this.sharedSessionName as string, 'action', 'write', '3']);
					return;
				}
				await this.runTerminal(['--session', this.sharedSessionName as string, 'action', 'write-chars', keys]);
			});
			return;
		}

		if (!options.literal && keys === 'Enter') {
			await this.runTerminal(['--session', handle.sessionName, 'action', 'write', '13']);
			return;
		}
		if (!options.literal && keys === 'C-c') {
			await this.runTerminal(['--session', handle.sessionName, 'action', 'write', '3']);
			return;
		}
		await this.runTerminal(['--session', handle.sessionName, 'action', 'write-chars', keys]);
	}

	public async capturePane(handle: TerminalSessionHandle, _startLine = -200): Promise<string> {
		if (this.sharedSessionName) {
			const result = await this.runTerminal([
				'--session',
				this.sharedSessionName,
				'action',
				'dump-screen',
				'--pane-id',
				handle.paneId
			]);
			return result.stdout.replace(/\r\n/g, '\n');
		}

		const result = await this.runTerminal(['--session', handle.sessionName, 'action', 'dump-screen']);
		return result.stdout.replace(/\r\n/g, '\n');
	}

	public async readPaneState(handle: TerminalSessionHandle): Promise<{ dead: boolean; exitCode: number }> {
		if (this.sharedSessionName) {
			const pane = await this.findPaneById(handle.paneId);
			if (!pane) {
				return {
					dead: true,
					exitCode: 1
				};
			}
			return {
				dead: pane.exited,
				exitCode: pane.exitStatus ?? 0
			};
		}

		const alive = await this.hasSession(handle.sessionName);
		return {
			dead: !alive,
			exitCode: alive ? 0 : 1
		};
	}

	public async killSession(handle: TerminalSessionHandle): Promise<void> {
		try {
			if (this.sharedSessionName) {
				await this.withPaneFocus(handle.paneId, async () => {
					await this.runTerminal(['--session', this.sharedSessionName as string, 'action', 'close-pane']);
				});
				return;
			}
			await this.runTerminal(['delete-session', '--force', handle.sessionName]);
		} catch {
			// Best effort. Callers own lifecycle normalization.
		}
	}

	public async hasSession(sessionName: string): Promise<boolean> {
		if (this.sharedSessionName) {
			return Boolean(await this.findPaneByTitle(sessionName));
		}

		try {
			const result = await this.runTerminal(['list-sessions']);
			const lines = result.stdout
				.split(/\r?\n/)
				.map((line) => stripAnsi(line).trim())
				.filter((line) => line.length > 0);
			return lines.some((line) => line.startsWith(`${sessionName} `) || line === sessionName);
		} catch {
			return false;
		}
	}

	private async openSharedSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
		const sessionPrefix = request.sessionPrefix?.trim() || 'mission-agent';
		const sessionName = `${sessionPrefix}-${randomUUID()}`;
		const launchCommand = buildLaunchCommand(request);
		const pilotPane = await this.resolvePilotPane();
		const createPaneResult = await this.runTerminal([
			'--session',
			this.sharedSessionName as string,
			'action',
			'new-pane',
			'--tab-id',
			String(pilotPane.tabId),
			'--name',
			sessionName,
			'--cwd',
			request.workingDirectory,
			'--',
			'sh',
			'-lc',
			`exec ${launchCommand}`
		]);
		const paneId = parsePaneReference(createPaneResult.stdout);
		if (!paneId) {
			throw new Error(`Unable to resolve created terminal-manager pane for '${sessionName}'.`);
		}
		await this.runTerminal([
			'--session',
			this.sharedSessionName as string,
			'action',
			'stack-panes',
			'--',
			toPaneReference(pilotPane.id),
			paneId
		]);

		return {
			sessionName,
			paneId
		};
	}

	private async openStandaloneSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
		const sessionPrefix = request.sessionPrefix?.trim() || 'mission-agent';
		const sessionName = `${sessionPrefix}-${randomUUID()}`;
		const launchCommand = buildLaunchCommand(request);

		const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mission-terminal-manager-'));
		const layoutFile = path.join(tempDir, `${sessionName}.kdl`);
		try {
			await writeFile(layoutFile, buildSinglePaneLayout(request.workingDirectory, launchCommand), 'utf8');
			await this.runTerminal([
				'--new-session-with-layout',
				layoutFile,
				'attach',
				'--create-background',
				sessionName,
			]);
			let sessionVisible = false;
			for (let attempt = 0; attempt < 20; attempt += 1) {
				if (await this.hasSession(sessionName)) {
					sessionVisible = true;
					break;
				}
				await delay(150);
			}
			if (!sessionVisible) {
				throw new Error(`terminal-manager session '${sessionName}' did not become visible after launch.`);
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		return {
			sessionName,
			paneId: sessionName
		};
	}

	private async listSessionPanes(): Promise<TerminalPaneMetadata[]> {
		const result = await this.runTerminal([
			'--session',
			this.sharedSessionName as string,
			'action',
			'list-panes',
			'--json',
			'--all'
		]);
		const parsed = JSON.parse(result.stdout) as TerminalPaneMetadata[];
		return parsed.filter((pane) => !pane.is_plugin);
	}

	private async resolvePilotPane(): Promise<TerminalPaneMetadata> {
		const pane = await this.findPaneByTitle(this.pilotPaneTitle);
		if (!pane) {
			throw new Error(`Unable to locate terminal-manager pane '${this.pilotPaneTitle}' in session '${this.sharedSessionName ?? 'unknown'}'.`);
		}
		return pane;
	}

	private async findPaneByTitle(title: string): Promise<TerminalPaneMetadata | undefined> {
		const panes = await this.listSessionPanes();
		return panes.find((pane) => pane.title === title && !pane.is_suppressed);
	}

	private async findPaneById(paneId: string): Promise<TerminalPaneMetadata | undefined> {
		const panes = await this.listSessionPanes();
		const numericId = parsePaneNumericId(paneId);
		return panes.find((pane) => pane.id === numericId);
	}

	private async focusPane(paneId: string): Promise<void> {
		await this.runTerminal([
			'--session',
			this.sharedSessionName as string,
			'action',
			'focus-pane-id',
			paneId
		]);
	}

	private async getFocusedPaneId(): Promise<string | undefined> {
		const panes = await this.listSessionPanes();
		const focusedPane = panes.find((pane) => pane.is_focused);
		return focusedPane ? toPaneReference(focusedPane.id) : undefined;
	}

	private async withPaneFocus<T>(paneId: string, operation: () => Promise<T>): Promise<T> {
		const previouslyFocusedPaneId = await this.getFocusedPaneId();
		if (previouslyFocusedPaneId !== paneId) {
			await this.focusPane(paneId);
		}
		try {
			return await operation();
		} finally {
			if (previouslyFocusedPaneId && previouslyFocusedPaneId !== paneId) {
				await this.focusPane(previouslyFocusedPaneId);
			}
		}
	}

	private async runTerminal(args: string[]): Promise<TerminalExecutorResult> {
		this.logLine?.(`terminal-manager ${args.join(' ')}`);
		return this.executor(args);
	}
}

type TerminalPaneMetadata = {
	id: number;
	title: string;
	tabId: number;
	exited: boolean;
	exitStatus: number | null;
	is_plugin: boolean;
	is_focused?: boolean;
	is_suppressed?: boolean;
	tab_id: number;
};

function buildLaunchCommand(request: TerminalOpenSessionRequest): string {
	const command = request.command.trim();
	if (!command) {
		throw new Error('TerminalAgentTransport requires a command.');
	}
	const envAssignments = Object.entries(request.env ?? {})
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${key}=${shellEscape(value as string)}`);
	const commandParts = [command, ...(request.args ?? [])].map(shellEscape);
	return envAssignments.length > 0
		? `env ${envAssignments.join(' ')} ${commandParts.join(' ')}`
		: commandParts.join(' ');
}

function buildSinglePaneLayout(workingDirectory: string, launchCommand: string): string {
	const escapedCwd = kdlEscape(workingDirectory);
	const escapedLaunch = kdlEscape(`exec ${launchCommand}`);
	return `layout {
	default_tab_template {
		children
	}
	tab name=\"AGENT\" {
		pane name=\"AGENT\" focus=true command=\"sh\" cwd=\"${escapedCwd}\" {
			args \"-lc\" \"${escapedLaunch}\"
		}
	}
}\n`;
}

function kdlEscape(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value: string): string {
	return value.replace(/\u001b\[[0-9;]*m/gu, '');
}

function parsePaneReference(stdout: string): string | undefined {
	const match = stdout.match(/(?:terminal|plugin)_\d+/u);
	return match?.[0];
}

function parsePaneNumericId(paneId: string): number {
	const match = paneId.match(/(?:terminal|plugin)_?(\d+)/u);
	if (!match) {
		throw new Error(`Invalid terminal-manager pane id '${paneId}'.`);
	}
	return Number.parseInt(match[1] ?? '', 10);
}

function toPaneReference(paneId: number): string {
	return `terminal_${String(paneId)}`;
}