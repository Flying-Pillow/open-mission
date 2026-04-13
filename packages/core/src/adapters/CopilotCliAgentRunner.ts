import type { AgentRunner } from '../runtime/AgentRunner.js';
import type {
	AgentLaunchRequest,
	AgentPrompt,
	AgentRuntimePrimitive,
	AgentSessionEvent,
	AgentSessionReference,
	AgentSessionSnapshot,
	AgentSteerAction
} from '../runtime/AgentRuntimeTypes.js';
import { COPILOT_CLI_AGENT_RUNNER_ID } from '../lib/agentRuntimes.js';
import {
	TerminalAgentTransport,
	type TerminalAgentTransportOptions,
	type TerminalSessionHandle
} from './TerminalAgentTransport.js';

type TerminalRunnerSessionHandle = {
	transportHandle: TerminalSessionHandle;
	snapshot: AgentSessionSnapshot;
	lastCapture: string;
	pollTimer: ReturnType<typeof setInterval> | undefined;
	polling: boolean;
};

type Listener = (event: AgentSessionEvent) => void;

type SnapshotOverrides = Partial<AgentSessionSnapshot> & {
	failureMessage?: string | undefined;
};

export type CopilotCliAgentRunnerOptions = TerminalAgentTransportOptions & {
	runnerId?: string;
	displayName?: string;
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	sessionPrefix?: string;
	pollIntervalMs?: number;
};

export class CopilotCliAgentRunner implements AgentRunner {
	public readonly id: string;
	public readonly displayName: string;

	private readonly transport: TerminalAgentTransport;
	private readonly command: string;
	private readonly args: string[];
	private readonly env: NodeJS.ProcessEnv | undefined;
	private readonly sessionPrefix: string;
	private readonly pollIntervalMs: number;
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly sessions = new Map<string, TerminalRunnerSessionHandle>();
	private readonly listeners = new Set<Listener>();

	public constructor(options: CopilotCliAgentRunnerOptions) {
		this.id = options.runnerId?.trim() || COPILOT_CLI_AGENT_RUNNER_ID;
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

	public async checkAvailability(): Promise<{ available: boolean; detail?: string }> {
		return this.transport.isAvailable();
	}

	public observe(listener: Listener): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			}
		};
	}

	public async launch(request: AgentLaunchRequest): Promise<AgentSessionSnapshot> {
		const availability = await this.checkAvailability();
		if (!availability.available) {
			throw new Error(availability.detail ?? `${this.displayName} is unavailable.`);
		}

		const requestedSharedSessionName = getRequestedTerminalSessionName(request);
		const transportHandle = await this.transport.openSession({
			workingDirectory: request.workingDirectory,
			command: this.command,
			args: this.args,
			...(this.env ? { env: this.env } : {}),
			sessionPrefix: this.sessionPrefix,
			sessionName: buildTaskSessionName(request.task.taskId, this.id),
			...(requestedSharedSessionName ? { sharedSessionName: requestedSharedSessionName } : {})
		});

		const snapshot = createRunningSnapshot({
			runnerId: this.id,
			sessionId: transportHandle.sessionName,
			workingDirectory: request.workingDirectory,
			taskId: request.task.taskId,
			missionId: request.missionId,
			stageId: request.task.stageId,
			transport: {
				kind: 'terminal',
				terminalSessionName: transportHandle.sharedSessionName ?? transportHandle.sessionName,
				...(transportHandle.paneId !== transportHandle.sessionName ? { paneId: transportHandle.paneId } : {})
			}
		});
		this.registerHandle(transportHandle, snapshot);

		if (request.initialPrompt?.text) {
			await this.prompt(transportHandle.sessionName, request.initialPrompt);
		}

		return cloneSnapshot(this.requireSnapshot(transportHandle.sessionName));
	}

	public async attach(reference: AgentSessionReference): Promise<AgentSessionSnapshot> {
		const existing = this.sessions.get(reference.sessionId);
		if (existing) {
			return cloneSnapshot(existing.snapshot);
		}

		const transportHandle = reference.transport?.paneId
			? await this.transport.attachSession(reference.sessionId, {
				sharedSessionName: reference.transport.terminalSessionName,
				paneId: reference.transport.paneId
			})
			: await this.transport.attachSession(reference.sessionId, {
				sharedSessionName: reference.transport?.terminalSessionName
			});
		if (!transportHandle) {
			return createTerminatedAttachedSnapshot(this.id, reference, 'Session no longer exists in terminal transport.');
		}

		const paneState = await this.transport.readPaneState(transportHandle);
		const initialCapture = paneState.dead ? '' : await this.transport.capturePane(transportHandle).catch(() => '');

		const snapshot = paneState.dead
			? createTerminalSnapshot({
				runnerId: this.id,
				sessionId: reference.sessionId,
				workingDirectory: 'unknown',
				taskId: 'unknown',
				missionId: 'unknown',
				stageId: 'unknown',
				transport: {
					kind: 'terminal',
					terminalSessionName: transportHandle.sharedSessionName ?? transportHandle.sessionName,
					...(transportHandle.paneId !== transportHandle.sessionName ? { paneId: transportHandle.paneId } : {})
				},
				status: paneState.exitCode === 0 ? 'completed' : 'failed',
				progressState: paneState.exitCode === 0 ? 'done' : 'failed',
				acceptsPrompts: false,
				acceptedActions: [],
				...(paneState.exitCode === 0
					? {}
					: { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` }),
				endedAt: new Date().toISOString()
			})
			: createRunningSnapshot({
				runnerId: this.id,
				sessionId: reference.sessionId,
				workingDirectory: 'unknown',
				taskId: 'unknown',
				missionId: 'unknown',
				stageId: 'unknown',
				transport: {
					kind: 'terminal',
					terminalSessionName: transportHandle.sharedSessionName ?? transportHandle.sessionName,
					...(transportHandle.paneId !== transportHandle.sessionName ? { paneId: transportHandle.paneId } : {})
				}
			});
		this.registerHandle(transportHandle, snapshot, initialCapture);
		return cloneSnapshot(snapshot);
	}

	public async list(): Promise<AgentSessionSnapshot[]> {
		return [...this.sessions.values()].map((handle) => cloneSnapshot(handle.snapshot));
	}

	private registerHandle(transportHandle: TerminalSessionHandle, snapshot: AgentSessionSnapshot, lastCapture = ''): void {
		const handle: TerminalRunnerSessionHandle = {
			transportHandle,
			snapshot,
			lastCapture,
			pollTimer: undefined,
			polling: false
		};
		this.sessions.set(transportHandle.sessionName, handle);
		if (!isTerminalStatus(snapshot.status)) {
			this.startPolling(transportHandle.sessionName);
		}
	}

	public async prompt(sessionId: string, prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
		const handle = this.requireActiveHandle(sessionId, 'submit a prompt');
		await this.preparePaneForPrompt(handle);
		await sendText(this.transport, handle.transportHandle, prompt.text);
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			acceptsPrompts: true,
			acceptedActions: ['pause', 'checkpoint', 'nudge', 'finish'],
			progress: {
				state: 'working',
				updatedAt: new Date().toISOString()
			}
		});
		this.emit({ type: 'session.updated', snapshot: cloneSnapshot(snapshot) });
		return cloneSnapshot(snapshot);
	}

	public async steer(
		sessionId: string,
		action: AgentSteerAction,
		options?: {
			reason?: string;
			metadata?: Record<string, AgentRuntimePrimitive>;
		}
	): Promise<AgentSessionSnapshot> {
		const handle = this.requireActiveHandle(sessionId, `apply action '${action}'`);
		if (action === 'pause') {
			await this.transport.sendKeys(handle.transportHandle, 'C-c');
			const snapshot = this.updateSnapshot(sessionId, {
				status: 'awaiting-input',
				attention: 'awaiting-system',
				waitingForInput: true,
				acceptedActions: ['resume', 'checkpoint', 'nudge', 'finish'],
				progress: {
					state: 'waiting-input',
					detail: options?.reason,
					updatedAt: new Date().toISOString()
				}
			});
			this.emit({ type: 'session.awaiting-input', snapshot: cloneSnapshot(snapshot) });
			return cloneSnapshot(snapshot);
		}

		return this.prompt(sessionId, buildSteerPrompt(action, options?.reason));
	}

	public async cancel(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const handle = this.requireHandle(sessionId);
		await this.transport.killSession(handle.transportHandle);
		this.stopPolling(handle);
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'cancelled',
			attention: 'none',
			acceptsPrompts: false,
			waitingForInput: false,
			acceptedActions: [],
			endedAt: new Date().toISOString(),
			progress: {
				state: 'done',
				detail: reason,
				updatedAt: new Date().toISOString()
			},
			...(reason ? { failureMessage: reason } : {})
		});
		this.emit({
			type: 'session.cancelled',
			...(reason ? { reason } : {}),
			snapshot: cloneSnapshot(snapshot)
		});
		return cloneSnapshot(snapshot);
	}

	public async terminate(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const handle = this.requireHandle(sessionId);
		await this.transport.killSession(handle.transportHandle);
		this.stopPolling(handle);
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'terminated',
			attention: 'none',
			acceptsPrompts: false,
			waitingForInput: false,
			acceptedActions: [],
			endedAt: new Date().toISOString(),
			progress: {
				state: 'failed',
				detail: reason,
				updatedAt: new Date().toISOString()
			},
			...(reason ? { failureMessage: reason } : {})
		});
		this.emit({
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
		if (!handle || handle.polling || isTerminalStatus(handle.snapshot.status)) {
			return;
		}
		handle.polling = true;
		try {
			const exists = await this.transport.hasSession(handle.transportHandle.sessionName);
			if (!exists) {
				this.stopPolling(handle);
				const snapshot = this.updateSnapshot(sessionId, {
					status: 'terminated',
					attention: 'none',
					acceptsPrompts: false,
					waitingForInput: false,
					acceptedActions: [],
					endedAt: new Date().toISOString(),
					progress: {
						state: 'failed',
						detail: 'terminal session no longer exists.',
						updatedAt: new Date().toISOString()
					},
					failureMessage: 'terminal session no longer exists.'
				});
				this.emit({
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
				this.emit({
					type: 'session.message',
					channel: 'stdout',
					text: line,
					snapshot: cloneSnapshot(handle.snapshot)
				});
			}

			const paneState = await this.transport.readPaneState(handle.transportHandle);
			if (paneState.dead) {
				this.stopPolling(handle);
				const nextStatus = paneState.exitCode === 0 ? 'completed' : 'failed';
				const snapshot = this.updateSnapshot(sessionId, {
					status: nextStatus,
					attention: 'none',
					acceptsPrompts: false,
					waitingForInput: false,
					acceptedActions: [],
					endedAt: new Date().toISOString(),
					progress: {
						state: paneState.exitCode === 0 ? 'done' : 'failed',
						updatedAt: new Date().toISOString()
					},
					...(paneState.exitCode === 0
						? {}
						: { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` })
				});
				if (nextStatus === 'completed') {
					this.emit({
						type: 'session.completed',
						snapshot: cloneSnapshot(snapshot)
					});
				} else {
					this.emit({
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
		if (isTerminalStatus(handle.snapshot.status)) {
			throw new Error(`Cannot ${action} for session '${sessionId}' because it is ${handle.snapshot.status}.`);
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
			acceptedActions: overrides.acceptedActions
				? [...overrides.acceptedActions]
				: [...handle.snapshot.acceptedActions],
			progress: overrides.progress
				? {
					...overrides.progress,
					...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {})
				}
				: {
					...handle.snapshot.progress,
					...(handle.snapshot.progress.units ? { units: { ...handle.snapshot.progress.units } } : {})
				},
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
			const nextStatus = paneState.exitCode === 0 ? 'completed' : 'failed';
			const snapshot = this.updateSnapshot(handle.transportHandle.sessionName, {
				status: nextStatus,
				attention: 'none',
				acceptsPrompts: false,
				waitingForInput: false,
				acceptedActions: [],
				endedAt: new Date().toISOString(),
				progress: {
					state: nextStatus === 'completed' ? 'done' : 'failed',
					updatedAt: new Date().toISOString()
				},
				...(nextStatus === 'failed'
					? { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` }
					: {})
			});
			this.emit(
				nextStatus === 'completed'
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
				nextStatus === 'completed'
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

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

function buildTaskSessionName(taskId: string, runnerId: string): string {
	const taskSegment = taskId.split('/').at(-1)?.trim() || taskId.trim();
	const normalizedTaskSegment = slugSessionSegment(taskSegment);
	const normalizedRunnerId = slugSessionSegment(runnerId);
	if (!normalizedTaskSegment) {
		return normalizedRunnerId || 'mission-agent';
	}
	return normalizedRunnerId ? `${normalizedTaskSegment}-${normalizedRunnerId}` : normalizedTaskSegment;
}

function slugSessionSegment(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
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
		acceptedActions: [...snapshot.acceptedActions],
		progress: {
			...snapshot.progress,
			...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {})
		},
		...(snapshot.transport ? { transport: { ...snapshot.transport } } : {})
	};
}

function isTerminalStatus(status: AgentSessionSnapshot['status']): boolean {
	return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'terminated';
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

function createRunningSnapshot(input: {
	runnerId: string;
	sessionId: string;
	workingDirectory: string;
	taskId: string;
	missionId: string;
	stageId: string;
	transport: AgentSessionSnapshot['transport'];
}): AgentSessionSnapshot {
	return createTerminalSnapshot({
		...input,
		status: 'running',
		progressState: 'working',
		acceptsPrompts: true,
		acceptedActions: ['pause', 'checkpoint', 'nudge', 'finish']
	});
}

function createTerminalSnapshot(input: {
	runnerId: string;
	sessionId: string;
	workingDirectory: string;
	taskId: string;
	missionId: string;
	stageId: string;
	transport: AgentSessionSnapshot['transport'];
	status: AgentSessionSnapshot['status'];
	progressState: AgentSessionSnapshot['progress']['state'];
	acceptsPrompts: boolean;
	acceptedActions: AgentSteerAction[];
	failureMessage?: string;
	endedAt?: string;
}): AgentSessionSnapshot {
	const timestamp = new Date().toISOString();
	return {
		runnerId: input.runnerId,
		sessionId: input.sessionId,
		workingDirectory: input.workingDirectory,
		taskId: input.taskId,
		missionId: input.missionId,
		stageId: input.stageId,
		status: input.status,
		attention: input.status === 'running' ? 'autonomous' : 'none',
		progress: {
			state: input.progressState,
			updatedAt: timestamp
		},
		waitingForInput: false,
		acceptsPrompts: input.acceptsPrompts,
		acceptedActions: [...input.acceptedActions],
		transport: input.transport,
		startedAt: timestamp,
		updatedAt: timestamp,
		...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
		...(input.endedAt ? { endedAt: input.endedAt } : {})
	};
}

function createTerminatedAttachedSnapshot(
	runnerId: string,
	reference: AgentSessionReference,
	reason: string
): AgentSessionSnapshot {
	const timestamp = new Date().toISOString();
	return {
		runnerId,
		sessionId: reference.sessionId,
		workingDirectory: 'unknown',
		taskId: 'unknown',
		missionId: 'unknown',
		stageId: 'unknown',
		status: 'terminated',
		attention: 'none',
		progress: {
			state: 'failed',
			detail: reason,
			updatedAt: timestamp
		},
		waitingForInput: false,
		acceptsPrompts: false,
		acceptedActions: [],
		...(reference.transport ? { transport: { ...reference.transport } } : {}),
		failureMessage: reason,
		startedAt: timestamp,
		updatedAt: timestamp,
		endedAt: timestamp
	};
}

function getRequestedTerminalSessionName(request: AgentLaunchRequest): string | undefined {
	const value = request.metadata?.['terminalSessionName'];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildSteerPrompt(action: AgentSteerAction, reason?: string): AgentPrompt {
	switch (action) {
		case 'resume':
			return { source: 'system', text: reason?.trim() || 'Resume execution.' };
		case 'checkpoint':
			return {
				source: 'system',
				text: reason?.trim() || 'Provide a concise checkpoint, then continue with the task.'
			};
		case 'nudge':
			return { source: 'system', text: reason?.trim() || 'Continue with the assigned task.' };
		case 'finish':
			return {
				source: 'system',
				text: reason?.trim() || 'Stop at a clean point and summarize completion status.'
			};
		default:
			throw new Error(`Action '${action}' is unsupported by ${COPILOT_CLI_AGENT_RUNNER_ID}.`);
	}
}