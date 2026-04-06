import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AgentRunner } from '../runtime/AgentRunner.js';
import type { AgentSession } from '../runtime/AgentSession.js';
import {
	type AgentCommand,
	type AgentRunnerCapabilities,
	type AgentSessionEvent,
	type AgentSessionReference,
	type AgentSessionSnapshot,
	type AgentSessionStartRequest,
	type AgentPrompt
} from '../runtime/AgentRuntimeTypes.js';
import { AgentSessionEventEmitter } from '../runtime/AgentSessionEventEmitter.js';

const execFileAsync = promisify(execFile);

type TmuxExecutorResult = {
	stdout: string;
	stderr: string;
};

type TmuxExecutor = (args: string[]) => Promise<TmuxExecutorResult>;

type TmuxSessionHandle = {
	sessionName: string;
	paneId: string;
	snapshot: AgentSessionSnapshot;
	eventEmitter: AgentSessionEventEmitter<AgentSessionEvent>;
	lastCapture: string;
	pollTimer: ReturnType<typeof setInterval> | undefined;
	polling: boolean;
};

type SnapshotOverrides = Omit<Partial<AgentSessionSnapshot>, 'failureMessage'> & {
	failureMessage?: string | undefined;
};

export type TmuxAgentRunnerOptions = {
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	logLine?: (line: string) => void;
	tmuxBinary?: string;
	sessionPrefix?: string;
	pollIntervalMs?: number;
	executor?: TmuxExecutor;
};

export class TmuxAgentRunner implements AgentRunner {
	public readonly id = 'tmux';
	public readonly displayName = 'tmux CLI';
	public readonly capabilities: AgentRunnerCapabilities = {
		attachableSessions: true,
		promptSubmission: true,
		structuredCommands: true,
		interruptible: true,
		interactiveInput: true,
		telemetry: false,
		mcpClient: false
	};

	private readonly command: string;
	private readonly args: string[];
	private readonly env: NodeJS.ProcessEnv | undefined;
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly tmuxBinary: string;
	private readonly sessionPrefix: string;
	private readonly pollIntervalMs: number;
	private readonly executor: TmuxExecutor;
	private readonly sessions = new Map<string, TmuxSessionHandle>();

	public constructor(options: TmuxAgentRunnerOptions) {
		this.command = options.command.trim();
		if (!this.command) {
			throw new Error('TmuxAgentRunner requires a command.');
		}
		this.args = options.args ? [...options.args] : [];
		this.env = options.env;
		this.logLine = options.logLine;
		this.tmuxBinary = options.tmuxBinary?.trim() || 'tmux';
		this.sessionPrefix = options.sessionPrefix?.trim() || 'mission-agent';
		this.pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 1000);
		this.executor = options.executor ?? (async (args) => {
			const result = await execFileAsync(this.tmuxBinary, args, {
				encoding: 'utf8',
				env: {
					...process.env,
					...this.env
				}
			});
			return {
				stdout: result.stdout,
				stderr: result.stderr
			};
		});
	}

	public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
		try {
			const result = await this.runTmux(['-V']);
			return {
				available: true,
				detail: result.stdout.trim() || 'tmux is available.'
			};
		} catch (error) {
			return {
				available: false,
				detail: error instanceof Error ? error.message : String(error)
			};
		}
	}

	public async startSession(request: AgentSessionStartRequest): Promise<AgentSession> {
		const availability = await this.isAvailable();
		if (!availability.available) {
			throw new Error(availability.detail ?? `${this.displayName} is unavailable.`);
		}

		const sessionName = `${this.sessionPrefix}-${randomUUID()}`;
		const launchCommand = this.buildLaunchCommand();
		const startResult = await this.runTmux([
			'new-session',
			'-d',
			'-P',
			'-F',
			'#{session_name} #{pane_id}',
			'-s',
			sessionName,
			'-c',
			request.workingDirectory,
			launchCommand
		]);
		const parsed = parseTmuxStartOutput(startResult.stdout);
		if (!parsed) {
			throw new Error(`TmuxAgentRunner could not parse tmux session output: ${startResult.stdout.trim()}`);
		}
		await this.runTmux(['set-option', '-t', `${parsed.sessionName}:0`, 'remain-on-exit', 'on']);

		const snapshot: AgentSessionSnapshot = {
			runnerId: this.id,
			sessionId: parsed.sessionName,
			phase: 'running',
			workingDirectory: request.workingDirectory,
			taskId: request.taskId,
			missionId: request.missionId,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt'],
			awaitingInput: false,
			updatedAt: new Date().toISOString()
		};
		const handle: TmuxSessionHandle = {
			sessionName: parsed.sessionName,
			paneId: parsed.paneId,
			snapshot,
			eventEmitter: new AgentSessionEventEmitter<AgentSessionEvent>(),
			lastCapture: '',
			pollTimer: undefined,
			polling: false
		};
		this.sessions.set(parsed.sessionName, handle);
		this.startPolling(parsed.sessionName);

		if (request.initialPrompt?.text) {
			await this.submitPromptInternal(parsed.sessionName, request.initialPrompt, false);
		}

		return this.createAgentSession(parsed.sessionName);
	}

	public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
		const existing = this.sessions.get(reference.sessionId);
		if (existing) {
			return this.createAgentSession(reference.sessionId);
		}

		const exists = await this.hasSession(reference.sessionId);
		if (!exists) {
			return this.createTerminatedAttachedSession(reference);
		}

		const paneId = await this.resolvePaneId(reference.sessionId);
		const snapshot: AgentSessionSnapshot = {
			runnerId: this.id,
			sessionId: reference.sessionId,
			phase: 'running',
			missionId: 'unknown',
			taskId: 'unknown',
			acceptsPrompts: true,
			acceptedCommands: ['interrupt'],
			awaitingInput: false,
			updatedAt: new Date().toISOString()
		};
		this.sessions.set(reference.sessionId, {
			sessionName: reference.sessionId,
			paneId,
			snapshot,
			eventEmitter: new AgentSessionEventEmitter<AgentSessionEvent>(),
			lastCapture: '',
			pollTimer: undefined,
			polling: false
		});
		this.startPolling(reference.sessionId);
		return this.createAgentSession(reference.sessionId);
	}

	public async listSessions(): Promise<AgentSessionSnapshot[]> {
		return [...this.sessions.values()].map((handle) => cloneSnapshot(handle.snapshot));
	}

	private createAgentSession(sessionId: string): AgentSession {
		return {
			runnerId: this.id,
			sessionId,
			getSnapshot: () => cloneSnapshot(this.requireSnapshot(sessionId)),
			onDidEvent: (listener) => this.requireHandle(sessionId).eventEmitter.event(listener),
			submitPrompt: (prompt) => this.submitPromptInternal(sessionId, prompt, true),
			submitCommand: (command) => this.submitCommandInternal(sessionId, command),
			cancel: (reason) => this.cancelSession(sessionId, reason),
			terminate: (reason) => this.terminateSession(sessionId, reason),
			dispose: () => {
				const handle = this.sessions.get(sessionId);
				if (!handle) {
					return;
				}
				this.stopPolling(handle);
				handle.eventEmitter.dispose();
			}
		};
	}

	private async submitPromptInternal(
		sessionId: string,
		prompt: AgentPrompt,
		recordEvent: boolean
	): Promise<AgentSessionSnapshot> {
		const handle = this.requireActiveHandle(sessionId, 'submit a prompt');
		await this.sendText(handle.paneId, prompt.text);
		const snapshot = this.updateSnapshot(sessionId, {
			phase: 'running',
			awaitingInput: false
		});
		if (recordEvent) {
			handle.eventEmitter.fire({
				type: 'prompt.accepted',
				prompt,
				snapshot: cloneSnapshot(snapshot)
			});
		}
		return cloneSnapshot(snapshot);
	}

	private async submitCommandInternal(sessionId: string, command: AgentCommand): Promise<AgentSessionSnapshot> {
		const handle = this.requireActiveHandle(sessionId, `submit command '${command.kind}'`);
		if (command.kind !== 'interrupt') {
			const reason = `Command '${command.kind}' is unsupported by ${this.displayName}.`;
			handle.eventEmitter.fire({
				type: 'command.rejected',
				command,
				reason,
				snapshot: cloneSnapshot(handle.snapshot)
			});
			throw new Error(reason);
		}

		await this.runTmux(['send-keys', '-t', handle.paneId, 'C-c']);
		const snapshot = this.updateSnapshot(sessionId, {
			phase: 'running',
			awaitingInput: true
		});
		handle.eventEmitter.fire({
			type: 'command.accepted',
			command,
			snapshot: cloneSnapshot(snapshot)
		});
		handle.eventEmitter.fire({
			type: 'session.awaiting-input',
			snapshot: cloneSnapshot(snapshot)
		});
		return cloneSnapshot(snapshot);
	}

	private async cancelSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const handle = this.requireHandle(sessionId);
		await this.killSession(handle.sessionName);
		this.stopPolling(handle);
		const snapshot = this.updateSnapshot(sessionId, {
			phase: 'cancelled',
			acceptsPrompts: false,
			awaitingInput: false,
			...(reason ? { failureMessage: reason } : {})
		});
		handle.eventEmitter.fire({
			type: 'session.cancelled',
			...(reason ? { reason } : {}),
			snapshot: cloneSnapshot(snapshot)
		});
		return cloneSnapshot(snapshot);
	}

	private async terminateSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const handle = this.requireHandle(sessionId);
		await this.killSession(handle.sessionName);
		this.stopPolling(handle);
		const snapshot = this.updateSnapshot(sessionId, {
			phase: 'terminated',
			acceptsPrompts: false,
			awaitingInput: false,
			...(reason ? { failureMessage: reason } : {})
		});
		handle.eventEmitter.fire({
			type: 'session.terminated',
			...(reason ? { reason } : {}),
			snapshot: cloneSnapshot(snapshot)
		});
		return cloneSnapshot(snapshot);
	}

	private startPolling(sessionId: string): void {
		const handle = this.requireHandle(sessionId);
		if (handle.pollTimer) {
			return;
		}
		handle.pollTimer = setInterval(() => {
			void this.pollSession(sessionId);
		}, this.pollIntervalMs);
		void this.pollSession(sessionId);
	}

	private stopPolling(handle: TmuxSessionHandle): void {
		if (!handle.pollTimer) {
			return;
		}
		clearInterval(handle.pollTimer);
		handle.pollTimer = undefined;
	}

	private async pollSession(sessionId: string): Promise<void> {
		const handle = this.sessions.get(sessionId);
		if (!handle || handle.polling || isTerminalPhase(handle.snapshot.phase)) {
			return;
		}
		handle.polling = true;
		try {
			const exists = await this.hasSession(handle.sessionName);
			if (!exists) {
				this.stopPolling(handle);
				const snapshot = this.updateSnapshot(sessionId, {
					phase: 'terminated',
					acceptsPrompts: false,
					awaitingInput: false,
					failureMessage: 'tmux session no longer exists.'
				});
				handle.eventEmitter.fire({
					type: 'session.terminated',
					reason: 'tmux session no longer exists.',
					snapshot: cloneSnapshot(snapshot)
				});
				return;
			}

			const capture = await this.capturePane(handle.paneId);
			const newLines = diffCapturedOutput(handle.lastCapture, capture);
			handle.lastCapture = capture;
			for (const line of newLines) {
				handle.eventEmitter.fire({
					type: 'session.message',
					channel: 'stdout',
					text: line,
					snapshot: cloneSnapshot(handle.snapshot)
				});
			}

			const paneState = await this.readPaneState(handle.paneId);
			if (paneState.dead) {
				this.stopPolling(handle);
				const nextPhase = paneState.exitCode === 0 ? 'completed' : 'failed';
				const snapshot = this.updateSnapshot(sessionId, {
					phase: nextPhase,
					acceptsPrompts: false,
					awaitingInput: false,
					...(paneState.exitCode === 0
						? {}
						: { failureMessage: `tmux command exited with status ${String(paneState.exitCode)}.` })
				});
				if (nextPhase === 'completed') {
					handle.eventEmitter.fire({
						type: 'session.completed',
						snapshot: cloneSnapshot(snapshot)
					});
				} else {
					handle.eventEmitter.fire({
						type: 'session.failed',
						reason: snapshot.failureMessage ?? 'tmux command failed.',
						snapshot: cloneSnapshot(snapshot)
					});
				}
			}
		} catch (error) {
			this.logLine?.(`TmuxAgentRunner poll failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			handle.polling = false;
		}
	}

	private requireHandle(sessionId: string): TmuxSessionHandle {
		const handle = this.sessions.get(sessionId);
		if (!handle) {
			throw new Error(`Agent session '${sessionId}' is not attached.`);
		}
		return handle;
	}

	private requireActiveHandle(sessionId: string, action: string): TmuxSessionHandle {
		const handle = this.requireHandle(sessionId);
		if (isTerminalPhase(handle.snapshot.phase)) {
			throw new Error(`Cannot ${action} for session '${sessionId}' because it is ${handle.snapshot.phase}.`);
		}
		if (!handle.snapshot.acceptsPrompts && action.includes('prompt')) {
			throw new Error(`Cannot ${action} for session '${sessionId}' because prompts are disabled.`);
		}
		return handle;
	}

	private requireSnapshot(sessionId: string): AgentSessionSnapshot {
		return this.requireHandle(sessionId).snapshot;
	}

	private updateSnapshot(sessionId: string, overrides: SnapshotOverrides): AgentSessionSnapshot {
		const handle = this.requireHandle(sessionId);
		const nextSnapshot: AgentSessionSnapshot = {
			...handle.snapshot,
			acceptedCommands: overrides.acceptedCommands
				? [...overrides.acceptedCommands]
				: [...handle.snapshot.acceptedCommands],
			updatedAt: new Date().toISOString()
		};
		for (const key of Object.keys(overrides) as Array<keyof SnapshotOverrides>) {
			const value = overrides[key];
			if (key === 'failureMessage' && value === undefined) {
				continue;
			}
			if (value !== undefined) {
				Object.assign(nextSnapshot, { [key]: value });
			}
		}
		if ('failureMessage' in overrides && overrides.failureMessage === undefined) {
			delete nextSnapshot.failureMessage;
		}
		handle.snapshot = nextSnapshot;
		return handle.snapshot;
	}

	private async hasSession(sessionName: string): Promise<boolean> {
		try {
			await this.runTmux(['has-session', '-t', sessionName]);
			return true;
		} catch {
			return false;
		}
	}

	private async resolvePaneId(sessionName: string): Promise<string> {
		const result = await this.runTmux(['display-message', '-p', '-t', sessionName, '#{pane_id}']);
		const paneId = result.stdout.trim();
		if (!paneId) {
			throw new Error(`TmuxAgentRunner could not resolve a pane for session '${sessionName}'.`);
		}
		return paneId;
	}

	private async readPaneState(paneId: string): Promise<{ dead: boolean; exitCode: number }> {
		const result = await this.runTmux(['display-message', '-p', '-t', paneId, '#{pane_dead} #{pane_dead_status}']);
		const [deadValue, exitValue] = result.stdout.trim().split(/\s+/, 2);
		return {
			dead: deadValue === '1',
			exitCode: Number.parseInt(exitValue ?? '0', 10) || 0
		};
	}

	private async capturePane(paneId: string): Promise<string> {
		const result = await this.runTmux(['capture-pane', '-p', '-t', paneId, '-S', '-200']);
		return result.stdout.replace(/\r\n/g, '\n');
	}

	private async sendText(paneId: string, text: string): Promise<void> {
		const normalized = text.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index] ?? '';
			if (line.length > 0) {
				await this.runTmux(['send-keys', '-t', paneId, '-l', line]);
			}
			if (index < lines.length - 1 || normalized.length === 0 || line.length > 0) {
				await this.runTmux(['send-keys', '-t', paneId, 'Enter']);
			}
		}
	}

	private async killSession(sessionName: string): Promise<void> {
		try {
			await this.runTmux(['kill-session', '-t', sessionName]);
		} catch {
			// Best-effort termination; local lifecycle state still needs to advance.
		}
	}

	private buildLaunchCommand(): string {
		const envAssignments = Object.entries(this.env ?? {})
			.filter(([, value]) => typeof value === 'string' && value.length > 0)
			.map(([key, value]) => `${key}=${shellEscape(value as string)}`);
		const commandParts = [this.command, ...this.args].map(shellEscape);
		return envAssignments.length > 0
			? `env ${envAssignments.join(' ')} ${commandParts.join(' ')}`
			: commandParts.join(' ');
	}

	private async runTmux(args: string[]): Promise<TmuxExecutorResult> {
		this.logLine?.(`tmux ${args.join(' ')}`);
		return this.executor(args);
	}

	private createTerminatedAttachedSession(reference: AgentSessionReference): AgentSession {
		const snapshot: AgentSessionSnapshot = {
			runnerId: this.id,
			sessionId: reference.sessionId,
			phase: 'terminated',
			missionId: 'unknown',
			taskId: 'unknown',
			acceptsPrompts: false,
			acceptedCommands: [],
			awaitingInput: false,
			failureMessage: 'Session no longer exists in tmux.',
			updatedAt: new Date().toISOString()
		};
		const eventEmitter = new AgentSessionEventEmitter<AgentSessionEvent>();
		this.sessions.set(reference.sessionId, {
			sessionName: reference.sessionId,
			paneId: '',
			snapshot,
			eventEmitter,
			lastCapture: '',
			pollTimer: undefined,
			polling: false
		});
		return {
			runnerId: this.id,
			sessionId: reference.sessionId,
			getSnapshot: () => cloneSnapshot(snapshot),
			onDidEvent: (listener) => {
				const subscription = eventEmitter.event(listener);
				queueMicrotask(() => {
					listener({
						type: 'session.terminated',
						reason: 'Session no longer exists in tmux.',
						snapshot: cloneSnapshot(snapshot)
					});
				});
				return subscription;
			},
			submitPrompt: async () => cloneSnapshot(snapshot),
			submitCommand: async () => cloneSnapshot(snapshot),
			cancel: async () => cloneSnapshot(snapshot),
			terminate: async () => cloneSnapshot(snapshot),
			dispose: () => {
				eventEmitter.dispose();
			}
		};
	}
}

function parseTmuxStartOutput(output: string): { sessionName: string; paneId: string } | undefined {
	const [sessionName, paneId] = output.trim().split(/\s+/, 2);
	if (!sessionName || !paneId) {
		return undefined;
	}
	return { sessionName, paneId };
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cloneSnapshot(snapshot: AgentSessionSnapshot): AgentSessionSnapshot {
	return {
		...snapshot,
		acceptedCommands: [...snapshot.acceptedCommands]
	};
}

function isTerminalPhase(phase: AgentSessionSnapshot['phase']): boolean {
	return phase === 'completed' || phase === 'failed' || phase === 'cancelled' || phase === 'terminated';
}

function diffCapturedOutput(previous: string, next: string): string[] {
	if (!next || next === previous) {
		return [];
	}
	if (!previous) {
		return splitLines(next);
	}
	if (next.startsWith(previous)) {
		return splitLines(next.slice(previous.length));
	}

	const previousLines = splitLines(previous);
	const nextLines = splitLines(next);
	const maxOverlap = Math.min(previousLines.length, nextLines.length);
	for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
		const previousTail = previousLines.slice(-overlap).join('\n');
		const nextHead = nextLines.slice(0, overlap).join('\n');
		if (previousTail === nextHead) {
			return nextLines.slice(overlap);
		}
	}
	return nextLines;
}

function splitLines(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
}