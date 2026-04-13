import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readMissionUserConfig } from '../lib/userConfig.js';

const execFileAsync = promisify(execFile);

export type TerminalExecutorResult = {
	stdout: string;
	stderr: string;
};

export type TerminalExecutor = (args: string[]) => Promise<TerminalExecutorResult>;

export type TerminalSessionHandle = {
	sessionName: string;
	paneId: string;
	sharedSessionName?: string | undefined;
};

export type TerminalAgentTransportOptions = {
	terminalBinary?: string;
	logLine?: (line: string) => void;
	executor?: TerminalExecutor;
	sharedSessionName?: string;
	agentSessionPaneTitle?: string;
};

export type TerminalOpenSessionRequest = {
	workingDirectory: string;
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	sessionPrefix?: string;
	sessionName?: string;
	sharedSessionName?: string;
};

export class TerminalAgentTransport {
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly executor: TerminalExecutor;
	private readonly sharedSessionName: string | undefined;
	private readonly agentSessionPaneTitle: string;

	public constructor(options: TerminalAgentTransportOptions = {}) {
		this.logLine = options.logLine;
		this.sharedSessionName = options.sharedSessionName?.trim()
			|| process.env['AIRPORT_TERMINAL_SESSION']?.trim()
			|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim()
			|| undefined;
		this.agentSessionPaneTitle = options.agentSessionPaneTitle?.trim() || 'RUNWAY';
		const terminalBinary = options.terminalBinary?.trim()
			|| readMissionUserConfig()?.terminalBinary?.trim()
			|| 'zellij';
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
		const sharedSessionName = request.sharedSessionName?.trim()
			|| this.sharedSessionName
			|| await this.discoverAirportLayoutSessionName();
		if (sharedSessionName) {
			try {
				return await this.openSharedSession(request, sharedSessionName);
			} catch (error) {
				if (!isMissingAgentSessionPaneError(error)) {
					throw error;
				}
			}
		}

		return this.openStandaloneSession(request);
	}

	public async attachSession(
		sessionName: string,
		options: { sharedSessionName?: string | undefined; paneId?: string | undefined } = {}
	): Promise<TerminalSessionHandle | undefined> {
		const sharedSessionName = Object.prototype.hasOwnProperty.call(options, 'sharedSessionName')
			? options.sharedSessionName?.trim() || undefined
			: this.sharedSessionName;
		if (sharedSessionName) {
			const pane = options.paneId
				? await this.findPaneById(options.paneId, sharedSessionName)
				: undefined;
			const resolvedPane = pane ?? await this.findPaneByTitle(sessionName, sharedSessionName);
			if (!resolvedPane) {
				return undefined;
			}
			return {
				sessionName,
				paneId: toPaneReference(resolvedPane.id),
				sharedSessionName
			};
		}

		const exists = await this.hasSession(sessionName, { sharedSessionName });
		if (!exists) {
			return undefined;
		}
		return {
			sessionName,
			paneId: sessionName,
			sharedSessionName: undefined
		};
	}

	public async sendKeys(handle: TerminalSessionHandle, keys: string, options: { literal?: boolean } = {}): Promise<void> {
		const sharedSessionName = this.resolveHandleSharedSessionName(handle);
		if (sharedSessionName) {
			await this.withPaneFocus(handle.paneId, async () => {
				if (!options.literal && keys === 'Enter') {
					await this.runTerminal(['--session', sharedSessionName, 'action', 'write', '13']);
					return;
				}
				if (!options.literal && keys === 'C-c') {
					await this.runTerminal(['--session', sharedSessionName, 'action', 'write', '3']);
					return;
				}
				await this.runTerminal(['--session', sharedSessionName, 'action', 'write-chars', keys]);
			}, sharedSessionName);
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
		const sharedSessionName = this.resolveHandleSharedSessionName(handle);
		if (sharedSessionName) {
			const result = await this.runTerminal([
				'--session',
				sharedSessionName,
				'action',
				'dump-screen',
				'--pane-id',
				handle.paneId
			]);
			return result.stdout.replace(/\r\n/g, '\n');
		}

		const standalonePane = await this.findStandalonePane(handle.sessionName);
		const result = await this.runTerminal([
			'--session',
			handle.sessionName,
			'action',
			'dump-screen',
			...(standalonePane ? ['--pane-id', toPaneReference(standalonePane.id)] : [])
		]);
		return result.stdout.replace(/\r\n/g, '\n');
	}

	public async readPaneState(handle: TerminalSessionHandle): Promise<{ dead: boolean; exitCode: number }> {
		const sharedSessionName = this.resolveHandleSharedSessionName(handle);
		if (sharedSessionName) {
			const pane = await this.findPaneById(handle.paneId, sharedSessionName);
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

		const standaloneAlive = await this.hasSession(handle.sessionName, { sharedSessionName: undefined });
		const standalonePane = await this.findStandalonePane(handle.sessionName).catch(() => undefined);
		if (standalonePane) {
			return {
				dead: standalonePane.exited,
				exitCode: standalonePane.exitStatus ?? 0
			};
		}
		return {
			dead: !standaloneAlive,
			exitCode: standaloneAlive ? 0 : 1
		};
	}

	public async killSession(handle: TerminalSessionHandle): Promise<void> {
		try {
			const sharedSessionName = this.resolveHandleSharedSessionName(handle);
			if (sharedSessionName) {
				await this.withPaneFocus(handle.paneId, async () => {
					await this.runTerminal(['--session', sharedSessionName, 'action', 'close-pane']);
				}, sharedSessionName);
				return;
			}
			await this.runTerminal(['delete-session', '--force', handle.sessionName]);
		} catch {
			// Best effort. Callers own lifecycle normalization.
		}
	}

	public async hasSession(sessionName: string, options: { sharedSessionName?: string | undefined } = {}): Promise<boolean> {
		const sharedSessionName = Object.prototype.hasOwnProperty.call(options, 'sharedSessionName')
			? options.sharedSessionName?.trim() || undefined
			: this.sharedSessionName;
		if (sharedSessionName) {
			return Boolean(await this.findPaneByTitle(sessionName, sharedSessionName));
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

	private async openSharedSession(request: TerminalOpenSessionRequest, sharedSessionName: string): Promise<TerminalSessionHandle> {
		const sessionName = await this.resolveLaunchSessionName(request, { sharedSessionName });
		const launchCommand = buildLaunchCommand(request);
		const agentSessionPane = await this.resolveAgentSessionPane(sharedSessionName);
		const agentSessionTabId = resolvePaneTabId(agentSessionPane);
		const panesBeforeLaunch = await this.listSessionPanesFor(sharedSessionName);
		const paneIdsBeforeLaunch = new Set(panesBeforeLaunch.map((pane) => pane.id));
		const createPaneResult = await this.runTerminal([
			'--session',
			sharedSessionName,
			'action',
			'new-pane',
			'--tab-id',
			String(agentSessionTabId),
			'--name',
			sessionName,
			'--cwd',
			request.workingDirectory,
			'--',
			'sh',
			'-lc',
			`exec ${launchCommand}`
		]);
		let paneId: string | undefined;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const panesAfterLaunch = await this.listSessionPanesFor(sharedSessionName);
			const createdPane = panesAfterLaunch.find((pane) => {
				if (paneIdsBeforeLaunch.has(pane.id)) {
					return false;
				}
				if (resolvePaneTabId(pane) !== agentSessionTabId) {
					return false;
				}
				if (pane.is_suppressed || pane.exited) {
					return false;
				}
				return true;
			});
			if (createdPane) {
				paneId = toPaneReference(createdPane.id);
				break;
			}
			await delay(100);
		}

		if (!paneId) {
			const createdPane = await this.findPaneByTitle(sessionName, sharedSessionName);
			paneId = createdPane
				? toPaneReference(createdPane.id)
				: parsePaneReference(`${createPaneResult.stdout}\n${createPaneResult.stderr}`);
		}
		if (!paneId) {
			throw new Error(`Unable to resolve created terminal-manager pane for '${sessionName}'.`);
		}
		await this.runTerminal([
			'--session',
			sharedSessionName,
			'action',
			'stack-panes',
			'--',
			toPaneReference(agentSessionPane.id),
			paneId
		]);
		await this.focusPane(paneId, sharedSessionName);

		return {
			sessionName,
			paneId,
			sharedSessionName
		};
	}

	private async openStandaloneSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
		const sessionName = await this.resolveLaunchSessionName(request, { sharedSessionName: undefined });
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
				if (await this.hasSession(sessionName, { sharedSessionName: undefined })) {
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
			paneId: sessionName,
			sharedSessionName: undefined
		};
	}

	private async resolveAgentSessionPane(sharedSessionName?: string): Promise<TerminalPaneMetadata> {
		const resolvedSessionName = sharedSessionName ?? this.sharedSessionName;
		if (!resolvedSessionName) {
			throw new Error('Shared terminal session name is required to resolve agent session pane.');
		}

		const panes = await this.listSessionPanesFor(resolvedSessionName);
		const livePane = panes.find((pane) => pane.title === this.agentSessionPaneTitle && !pane.is_suppressed && !pane.exited);
		if (livePane) {
			return livePane;
		}

		throw new Error(
			`Unable to locate terminal-manager pane '${this.agentSessionPaneTitle}' in session '${resolvedSessionName}'.`
			+ ' Select an agent session in Tower to insert the gate pane, then retry.'
		);
	}

	private async resolveLaunchSessionName(
		request: TerminalOpenSessionRequest,
		options: { sharedSessionName?: string | undefined }
	): Promise<string> {
		const explicitSessionName = request.sessionName?.trim();
		if (explicitSessionName) {
			return this.resolveAvailableSessionName(explicitSessionName, options);
		}

		const sessionPrefix = request.sessionPrefix?.trim() || 'mission-agent';
		return `${sessionPrefix}-${randomUUID()}`;
	}

	private async resolveAvailableSessionName(
		baseName: string,
		options: { sharedSessionName?: string | undefined }
	): Promise<string> {
		const normalizedBaseName = baseName.trim();
		if (!normalizedBaseName) {
			throw new Error('Terminal session name cannot be empty.');
		}

		if (!(await this.hasSession(normalizedBaseName, options))) {
			return normalizedBaseName;
		}

		for (let suffix = 2; suffix < 1000; suffix += 1) {
			const candidate = `${normalizedBaseName}-${String(suffix)}`;
			if (!(await this.hasSession(candidate, options))) {
				return candidate;
			}
		}

		return `${normalizedBaseName}-${randomUUID()}`;
	}

	private async findPaneByTitle(title: string, sharedSessionName?: string): Promise<TerminalPaneMetadata | undefined> {
		const panes = await this.listSessionPanesFor(sharedSessionName);
		return panes.find((pane) => pane.title === title && !pane.is_suppressed);
	}

	private async findPaneById(paneId: string, sharedSessionName?: string): Promise<TerminalPaneMetadata | undefined> {
		const panes = await this.listSessionPanesFor(sharedSessionName);
		const numericId = parsePaneNumericId(paneId);
		return panes.find((pane) => pane.id === numericId);
	}

	private async findStandalonePane(sessionName: string): Promise<TerminalPaneMetadata | undefined> {
		const panes = await this.listSessionPanesFor(sessionName);
		return panes.find((pane) => !pane.is_suppressed && !pane.is_plugin)
			?? panes.find((pane) => !pane.is_plugin);
	}

	private async focusPane(paneId: string, sharedSessionName = this.sharedSessionName): Promise<void> {
		if (!sharedSessionName) {
			throw new Error('Shared terminal session name is required to focus a pane.');
		}
		try {
			await this.runTerminal([
				'--session',
				sharedSessionName,
				'action',
				'focus-pane-id',
				paneId
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.toLowerCase().includes('already focused')) {
				return;
			}
			throw error;
		}
	}

	private async getFocusedPaneId(sharedSessionName = this.sharedSessionName): Promise<string | undefined> {
		const panes = await this.listSessionPanesFor(sharedSessionName);
		const focusedPane = panes.find((pane) => pane.is_focused);
		return focusedPane ? toPaneReference(focusedPane.id) : undefined;
	}

	private async listSessionPanesFor(sharedSessionName = this.sharedSessionName): Promise<TerminalPaneMetadata[]> {
		if (!sharedSessionName) {
			return [];
		}
		const result = await this.runTerminal([
			'--session',
			sharedSessionName,
			'action',
			'list-panes',
			'--json',
			'--all'
		]);
		const parsed = JSON.parse(result.stdout) as TerminalPaneMetadata[];
		return parsed.filter((pane) => !pane.is_plugin);
	}

	private async discoverAirportLayoutSessionName(): Promise<string | undefined> {
		let sessions: string[];
		try {
			sessions = await this.listSessionNames();
		} catch {
			return undefined;
		}
		for (const sessionName of sessions) {
			try {
				const panes = await this.listSessionPanesFor(sessionName);
				const hasAgentSessionPane = panes.some((pane) => pane.title === this.agentSessionPaneTitle && !pane.is_suppressed);
				if (hasAgentSessionPane) {
					return sessionName;
				}
			} catch {
				continue;
			}
		}
		return undefined;
	}

	private async listSessionNames(): Promise<string[]> {
		const result = await this.runTerminal(['list-sessions']);
		const lines = result.stdout
			.split(/\r?\n/)
			.map((line) => stripAnsi(line).trim())
			.filter((line) => line.length > 0);
		return lines
			.map((line) => parseTerminalManagerSessionName(line) ?? '')
			.filter((sessionName) => sessionName.length > 0);
	}

	private async withPaneFocus<T>(paneId: string, operation: () => Promise<T>, sharedSessionName = this.sharedSessionName): Promise<T> {
		const previouslyFocusedPaneId = await this.getFocusedPaneId(sharedSessionName);
		if (previouslyFocusedPaneId !== paneId) {
			await this.focusPane(paneId, sharedSessionName);
		}
		try {
			return await operation();
		} finally {
			if (previouslyFocusedPaneId && previouslyFocusedPaneId !== paneId) {
				try {
					await this.focusPane(previouslyFocusedPaneId, sharedSessionName);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!message.toLowerCase().includes('not found')) {
						throw error;
					}
				}
			}
		}
	}

	private async runTerminal(args: string[]): Promise<TerminalExecutorResult> {
		this.logLine?.(`terminal-manager ${args.join(' ')}`);
		return this.executor(args);
	}

	private resolveHandleSharedSessionName(handle: TerminalSessionHandle): string | undefined {
		return Object.prototype.hasOwnProperty.call(handle, 'sharedSessionName')
			? handle.sharedSessionName?.trim() || undefined
			: this.sharedSessionName;
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

function isMissingAgentSessionPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Unable to locate terminal-manager pane 'RUNWAY'");
}

function parseTerminalManagerSessionName(line: string): string | undefined {
	const normalizedLine = line.trim();
	if (!normalizedLine) {
		return undefined;
	}
	const withoutCreatedSuffix = normalizedLine.replace(/\s+\[[^\]]*\]\s*$/u, '');
	const withoutExitedSuffix = withoutCreatedSuffix.replace(/\s+\(EXITED[^)]*\)\s*$/u, '');
	return withoutExitedSuffix.trim() || undefined;
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

function resolvePaneTabId(pane: TerminalPaneMetadata): number {
	if (Number.isInteger(pane.tabId)) {
		return pane.tabId;
	}
	if (Number.isInteger(pane.tab_id)) {
		return pane.tab_id;
	}
	throw new Error(`Unable to resolve tab id for terminal-manager pane '${pane.title}'.`);
}