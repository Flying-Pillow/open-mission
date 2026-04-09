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
import { COPILOT_CLI_AGENT_RUNTIME_ID } from '../lib/agentRuntimes.js';
import {
	TerminalAgentTransport,
	type TerminalAgentTransportOptions,
	type TerminalSessionHandle
} from './TerminalAgentTransport.js';

type TerminalRunnerSessionHandle = {
	transportHandle: TerminalSessionHandle;
	snapshot: AgentSessionSnapshot;
	eventEmitter: AgentSessionEventEmitter<AgentSessionEvent>;
	lastCapture: string;
	pollTimer: ReturnType<typeof setInterval> | undefined;
	polling: boolean;
};

type SnapshotOverrides = Omit<Partial<AgentSessionSnapshot>, 'failureMessage'> & {
	failureMessage?: string | undefined;
};

export type CopilotCliAgentRunnerOptions = TerminalAgentTransportOptions & {
	runtimeId?: string;
	displayName?: string;
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	sessionPrefix?: string;
	pollIntervalMs?: number;
};

export class CopilotCliAgentRunner implements AgentRunner {
	public readonly id: string;
	public readonly transportId = 'terminal';
	public readonly displayName: string;
	public readonly capabilities: AgentRunnerCapabilities = {
		attachableSessions: true,
		promptSubmission: true,
		structuredCommands: true,
		interruptible: true,
		interactiveInput: true,
		telemetry: false,
		mcpClient: false
	};

	private readonly transport: TerminalAgentTransport;
	private readonly command: string;
	private readonly args: string[];
	private readonly env: NodeJS.ProcessEnv | undefined;
	private readonly sessionPrefix: string;
	private readonly pollIntervalMs: number;
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly sessions = new Map<string, TerminalRunnerSessionHandle>();

	public constructor(options: CopilotCliAgentRunnerOptions) {
		this.id = options.runtimeId?.trim() || COPILOT_CLI_AGENT_RUNTIME_ID;
		this.displayName = options.displayName?.trim() || `${this.id} via terminal-manager`;
		this.command = options.command.trim();
		if (!this.command) {
			throw new Error('CopilotCliAgentRunner requires a command.');
		}
		this.args = options.args ? [...options.args] : [];
		this.env = options.env;
		this.sessionPrefix = options.sessionPrefix?.trim() || 'mission-agent';
		this.pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 1000);
		this.logLine = options.logLine;
		this.transport = new TerminalAgentTransport({
			...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
			...(options.sharedSessionName ? { sharedSessionName: options.sharedSessionName } : {}),
			...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
			...(options.executor ? { executor: options.executor } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		});
	}

	public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
		return this.transport.isAvailable();
	}

	public async startSession(request: AgentSessionStartRequest): Promise<AgentSession> {
		const availability = await this.isAvailable();
		if (!availability.available) {
			throw new Error(availability.detail ?? `${this.displayName} is unavailable.`);
		}

		const transportHandle = await this.transport.openSession({
			workingDirectory: request.workingDirectory,
			command: this.command,
			args: this.args,
			...(this.env ? { env: this.env } : {}),
			sessionPrefix: this.sessionPrefix,
			...(request.terminalSessionName?.trim() ? { sharedSessionName: request.terminalSessionName.trim() } : {})
		});

		const snapshot: AgentSessionSnapshot = {
			runtimeId: this.id,
			transportId: this.transportId,
			sessionId: transportHandle.sessionName,
			phase: 'running',
			workingDirectory: request.workingDirectory,
			taskId: request.taskId,
			missionId: request.missionId,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt'],
			awaitingInput: false,
			updatedAt: new Date().toISOString()
		};
		this.registerHandle(transportHandle, snapshot);

		if (request.initialPrompt?.text) {
			await this.submitPromptInternal(transportHandle.sessionName, request.initialPrompt, false);
		}

		return this.createAgentSession(transportHandle.sessionName);
	}

	public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
		const existing = this.sessions.get(reference.sessionId);
		if (existing) {
			return this.createAgentSession(reference.sessionId);
		}

		const transportHandle = await this.transport.attachSession(reference.sessionId);
		if (!transportHandle) {
			return this.createTerminatedAttachedSession(reference);
		}

		const paneState = await this.transport.readPaneState(transportHandle);
		const initialCapture = paneState.dead ? '' : await this.transport.capturePane(transportHandle).catch(() => '');

		const snapshot: AgentSessionSnapshot = {
			runtimeId: this.id,
			transportId: this.transportId,
			sessionId: reference.sessionId,
			phase: paneState.dead ? (paneState.exitCode === 0 ? 'completed' : 'failed') : 'running',
			missionId: 'unknown',
			taskId: 'unknown',
			acceptsPrompts: !paneState.dead,
			acceptedCommands: ['interrupt'],
			awaitingInput: false,
			updatedAt: new Date().toISOString(),
			...(paneState.dead && paneState.exitCode !== 0
				? { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` }
				: {})
		};
		this.registerHandle(transportHandle, snapshot, initialCapture);
		return this.createAgentSession(reference.sessionId);
	}

	public async listSessions(): Promise<AgentSessionSnapshot[]> {
		return [...this.sessions.values()].map((handle) => cloneSnapshot(handle.snapshot));
	}

	private registerHandle(transportHandle: TerminalSessionHandle, snapshot: AgentSessionSnapshot, lastCapture = ''): void {
		const handle: TerminalRunnerSessionHandle = {
			transportHandle,
			snapshot,
			eventEmitter: new AgentSessionEventEmitter<AgentSessionEvent>(),
			lastCapture,
			pollTimer: undefined,
			polling: false
		};
		this.sessions.set(transportHandle.sessionName, handle);
		if (!isTerminalPhase(snapshot.phase)) {
			this.startPolling(transportHandle.sessionName);
		}
	}

	private createAgentSession(sessionId: string): AgentSession {
		return {
			runtimeId: this.id,
			transportId: this.transportId,
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
		await this.preparePaneForPrompt(handle);
		await sendText(this.transport, handle.transportHandle, prompt.text);
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

		await this.transport.sendKeys(handle.transportHandle, 'C-c');
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
		await this.transport.killSession(handle.transportHandle);
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
		await this.transport.killSession(handle.transportHandle);
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

	private stopPolling(handle: TerminalRunnerSessionHandle): void {
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
			const exists = await this.transport.hasSession(handle.transportHandle.sessionName);
			if (!exists) {
				this.stopPolling(handle);
				const snapshot = this.updateSnapshot(sessionId, {
					phase: 'terminated',
					acceptsPrompts: false,
					awaitingInput: false,
					failureMessage: 'terminal session no longer exists.'
				});
				handle.eventEmitter.fire({
					type: 'session.terminated',
					reason: 'terminal session no longer exists.',
					snapshot: cloneSnapshot(snapshot)
				});
				return;
			}

			const capture = await this.transport.capturePane(handle.transportHandle);
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

			const paneState = await this.transport.readPaneState(handle.transportHandle);
			if (paneState.dead) {
				this.stopPolling(handle);
				const nextPhase = paneState.exitCode === 0 ? 'completed' : 'failed';
				const snapshot = this.updateSnapshot(sessionId, {
					phase: nextPhase,
					acceptsPrompts: false,
					awaitingInput: false,
					...(paneState.exitCode === 0
						? {}
						: { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` })
				});
				if (nextPhase === 'completed') {
					handle.eventEmitter.fire({
						type: 'session.completed',
						snapshot: cloneSnapshot(snapshot)
					});
				} else {
					handle.eventEmitter.fire({
						type: 'session.failed',
						reason: snapshot.failureMessage ?? 'terminal command failed.',
						snapshot: cloneSnapshot(snapshot)
					});
				}
			}
		} catch (error) {
			this.logLine?.(`CopilotCliAgentRunner poll failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			handle.polling = false;
		}
	}

	private requireHandle(sessionId: string): TerminalRunnerSessionHandle {
		const handle = this.sessions.get(sessionId);
		if (!handle) {
			throw new Error(`Agent session '${sessionId}' is not attached.`);
		}
		return handle;
	}

	private requireActiveHandle(sessionId: string, action: string): TerminalRunnerSessionHandle {
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

	private async preparePaneForPrompt(handle: TerminalRunnerSessionHandle): Promise<void> {
		const paneState = await this.transport.readPaneState(handle.transportHandle);
		if (paneState.dead) {
			const nextPhase = paneState.exitCode === 0 ? 'completed' : 'failed';
			const snapshot = this.updateSnapshot(handle.transportHandle.sessionName, {
				phase: nextPhase,
				acceptsPrompts: false,
				awaitingInput: false,
				...(nextPhase === 'failed'
					? { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` }
					: {})
			});
			handle.eventEmitter.fire(
				nextPhase === 'completed'
					? {
						type: 'session.completed',
						snapshot: cloneSnapshot(snapshot)
					}
					: {
						type: 'session.failed',
						reason: snapshot.failureMessage ?? 'terminal command failed.',
						snapshot: cloneSnapshot(snapshot)
					}
			);
			throw new Error(
				nextPhase === 'completed'
					? `Cannot submit a prompt for session '${handle.transportHandle.sessionName}' because the terminal pane has exited.`
					: snapshot.failureMessage ?? `Cannot submit a prompt for session '${handle.transportHandle.sessionName}'.`
			);
		}

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const capture = await this.transport.capturePane(handle.transportHandle);
			if (!isFolderTrustPrompt(capture)) {
				return;
			}
			await this.transport.sendKeys(handle.transportHandle, 'Enter');
		}
	}

	private createTerminatedAttachedSession(reference: AgentSessionReference): AgentSession {
		const snapshot: AgentSessionSnapshot = {
			runtimeId: this.id,
			transportId: this.transportId,
			sessionId: reference.sessionId,
			phase: 'terminated',
			missionId: 'unknown',
			taskId: 'unknown',
			acceptsPrompts: false,
			acceptedCommands: [],
			awaitingInput: false,
			failureMessage: 'Session no longer exists in terminal transport.',
			updatedAt: new Date().toISOString()
		};
		const eventEmitter = new AgentSessionEventEmitter<AgentSessionEvent>();
		return {
			runtimeId: this.id,
			transportId: this.transportId,
			sessionId: reference.sessionId,
			getSnapshot: () => cloneSnapshot(snapshot),
			onDidEvent: (listener) => {
				const subscription = eventEmitter.event(listener);
				queueMicrotask(() => {
					listener({
						type: 'session.terminated',
						reason: 'Session no longer exists in terminal transport.',
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

async function sendText(transport: TerminalAgentTransport, handle: TerminalSessionHandle, text: string): Promise<void> {
	const normalized = text.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (line.length > 0) {
			await transport.sendKeys(handle, line, { literal: true });
		}
		if (index < lines.length - 1 || normalized.length === 0 || line.length > 0) {
			await transport.sendKeys(handle, 'Enter');
		}
	}
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

function isFolderTrustPrompt(capture: string): boolean {
	return capture.includes('Confirm folder trust')
		&& capture.includes('Do you trust the files in this folder?');
}