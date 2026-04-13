import type { AgentSession } from '../AgentSession.js';
import {
	AgentRunner,
	type AgentRunnerSessionController
} from '../AgentRunner.js';
import type {
	AgentCommand,
	AgentLaunchConfig,
	AgentPrompt,
	AgentRunnerCapabilities,
	AgentSessionEvent,
	AgentSessionReference,
	AgentSessionSnapshot
} from '../AgentRuntimeTypes.js';

export type FakeAgentSessionSnapshot = AgentSessionSnapshot & {
	phase: AgentSessionSnapshot['status'];
	awaitingInput: boolean;
	transportId?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
};

export type FakeAgentStartRequest = AgentLaunchConfig & {
	terminalSessionName?: string;
};

export interface FakeAgentSession extends AgentSession {
	getSnapshot(): FakeAgentSessionSnapshot;
	emitMessage(text: string, channel?: 'stdout' | 'stderr' | 'system' | 'agent'): void;
	emitAwaitingInput(reason?: string): void;
	overrideWorkingDirectory(workingDirectory: string): void;
	complete(): void;
	fail(reason: string): void;
}

	type SnapshotOverrides = Omit<Partial<AgentSessionSnapshot>, 'failureMessage'> & {
	failureMessage?: string | undefined;
};

export class FakeAgentRunner extends AgentRunner {
	private readonly sessionIds = new Set<string>();
	private readonly startRequests: FakeAgentStartRequest[] = [];
	private nextSessionId = 0;

	public constructor(
		id: string,
		displayName: string,
		private readonly transportId?: string
	) {
		super({ id, displayName });
	}

	public async getCapabilities(): Promise<AgentRunnerCapabilities> {
		return {
			acceptsPromptSubmission: true,
			acceptsCommands: true,
			supportsInterrupt: true,
			supportsResumeByReference: true,
			supportsCheckpoint: true,
			shareModes: this.transportId === 'terminal' ? ['terminal'] : []
		};
	}

	public async isAvailable(): Promise<{ available: boolean; reason?: string }> {
		return { available: true };
	}

	protected override async onStartSession(config: AgentLaunchConfig): Promise<AgentSession> {
		const sessionId = `${this.id}-session-${String(++this.nextSessionId)}`;
		const snapshot = createSnapshot(config, this.id, sessionId, this.transportId);
		this.startRequests.push(cloneStartRequest(config));
		this.sessionIds.add(sessionId);
		return this.createManagedSession({
			snapshot,
			controller: this.createSessionController(sessionId)
		});
	}

	protected override async onReconcileSession(reference: AgentSessionReference): Promise<AgentSession> {
		if (this.sessionIds.has(reference.sessionId)) {
			return this.attachManagedSession(reference.sessionId);
		}
		return this.createDetachedSession(createDetachedSnapshot(this.id, reference, 'Session no longer exists in fake runtime.'));
	}

	public listSessions(): FakeAgentSession[] {
		return [...this.sessionIds].map((sessionId) => this.createInspectableSession(sessionId));
	}

	public getSession(sessionId: string): FakeAgentSession | undefined {
		return this.sessionIds.has(sessionId) ? this.createInspectableSession(sessionId) : undefined;
	}

	public deleteSession(sessionId: string): void {
		if (!this.sessionIds.has(sessionId)) {
			return;
		}
		this.sessionIds.delete(sessionId);
		this.disposeManagedSession(sessionId);
	}

	public overrideSessionWorkingDirectory(sessionId: string, workingDirectory: string): void {
		this.updateSnapshot(sessionId, {
			workingDirectory,
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.emitSessionEvent({
			type: 'session.updated',
			snapshot: this.getManagedSnapshot(sessionId)
		});
	}

	public getLastStartRequest(): FakeAgentStartRequest | undefined {
		const request = this.startRequests.at(-1);
		return request ? cloneStartRequest(request) : undefined;
	}

	private createSessionController(sessionId: string): AgentRunnerSessionController {
		return {
			submitPrompt: async (prompt) => this.submitPrompt(sessionId, prompt),
			submitCommand: async (command) => this.submitCommand(sessionId, command),
			cancel: async (reason) => this.cancelSession(sessionId, reason),
			terminate: async (reason) => this.terminateSession(sessionId, reason)
		};
	}

	private createInspectableSession(sessionId: string): FakeAgentSession {
		return new FakeManagedAgentSession({
			getSnapshot: () => toLegacySnapshot(this.getManagedSnapshot(sessionId), this.transportId),
			observe: (listener) => this.attachManagedSession(sessionId).onDidEvent(listener),
			submitPrompt: (prompt) => this.submitPrompt(sessionId, prompt),
			submitCommand: (command) => this.submitCommand(sessionId, command),
			cancel: (reason) => this.cancelSession(sessionId, reason),
			terminate: (reason) => this.terminateSession(sessionId, reason),
			emitMessage: (text, channel) => this.emitMessage(sessionId, text, channel),
			emitAwaitingInput: (reason) => this.emitAwaitingInput(sessionId, reason),
			overrideWorkingDirectory: (workingDirectory) => this.overrideSessionWorkingDirectory(sessionId, workingDirectory),
			complete: () => this.completeSession(sessionId),
			fail: (reason) => this.failSession(sessionId, reason)
		});
	}

	private async submitPrompt(sessionId: string, _prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.emitSessionEvent({
			type: 'session.updated',
			snapshot
		});
		return snapshot;
	}

	private async submitCommand(sessionId: string, command: AgentCommand): Promise<AgentSessionSnapshot> {
		if (command.type === 'interrupt') {
			const snapshot = this.updateSnapshot(sessionId, {
				status: 'awaiting-input',
				attention: 'awaiting-operator',
				waitingForInput: true,
				acceptsPrompts: true,
				acceptedCommands: ['resume', 'checkpoint', 'nudge', 'interrupt'],
				progress: {
					state: 'waiting-input',
					...(command.reason ? { detail: command.reason } : {}),
					updatedAt: now()
				}
			});
			this.emitSessionEvent({
				type: 'session.awaiting-input',
				snapshot
			});
			return snapshot;
		}

		return this.submitPrompt(sessionId, buildCommandPrompt(command));
	}

	private async cancelSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const endedAt = now();
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'cancelled',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			endedAt,
			...(reason ? { failureMessage: reason } : {}),
			progress: {
				state: 'failed',
				...(reason ? { detail: reason } : {}),
				updatedAt: endedAt
			}
		});
		this.emitSessionEvent({
			type: 'session.cancelled',
			...(reason ? { reason } : {}),
			snapshot
		});
		return snapshot;
	}

	private async terminateSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const endedAt = now();
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'terminated',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			endedAt,
			...(reason ? { failureMessage: reason } : {}),
			progress: {
				state: 'failed',
				...(reason ? { detail: reason } : {}),
				updatedAt: endedAt
			}
		});
		this.emitSessionEvent({
			type: 'session.terminated',
			...(reason ? { reason } : {}),
			snapshot
		});
		return snapshot;
	}

	private emitMessage(
		sessionId: string,
		text: string,
		channel: 'stdout' | 'stderr' | 'system' | 'agent' = 'stdout'
	): void {
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'running',
			attention: 'autonomous',
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.emitSessionEvent({
			type: 'session.message',
			channel,
			text,
			snapshot
		});
	}

	private emitAwaitingInput(sessionId: string, reason?: string): void {
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'awaiting-input',
			attention: 'awaiting-operator',
			waitingForInput: true,
			acceptsPrompts: true,
			acceptedCommands: ['resume', 'checkpoint', 'nudge', 'interrupt'],
			progress: {
				state: 'waiting-input',
				...(reason ? { detail: reason } : {}),
				updatedAt: now()
			}
		});
		this.emitSessionEvent({
			type: 'session.awaiting-input',
			snapshot
		});
	}

	private completeSession(sessionId: string): void {
		const endedAt = now();
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'completed',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			endedAt,
			// failureMessage: undefined, // Removed to comply with new type definition
			progress: {
				state: 'done',
				updatedAt: endedAt
			}
		});
		this.emitSessionEvent({
			type: 'session.completed',
			snapshot
		});
	}

	private failSession(sessionId: string, reason: string): void {
		const endedAt = now();
		const snapshot = this.updateSnapshot(sessionId, {
			status: 'failed',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			endedAt,
			failureMessage: reason,
			progress: {
				state: 'failed',
				detail: reason,
				updatedAt: endedAt
			}
		});
		this.emitSessionEvent({
			type: 'session.failed',
			reason,
			snapshot
		});
	}

	private updateSnapshot(sessionId: string, overrides: SnapshotOverrides): AgentSessionSnapshot {
		return this.updateManagedSnapshot(sessionId, overrides);
	}
}

type FakeManagedAgentSessionOptions = {
	getSnapshot(): FakeAgentSessionSnapshot;
	observe(listener: (event: AgentSessionEvent) => void): { dispose(): void };
	submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
	submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
	cancel(reason?: string): Promise<AgentSessionSnapshot>;
	terminate(reason?: string): Promise<AgentSessionSnapshot>;
	emitMessage(text: string, channel?: 'stdout' | 'stderr' | 'system' | 'agent'): void;
	emitAwaitingInput(reason?: string): void;
	overrideWorkingDirectory(workingDirectory: string): void;
	complete(): void;
	fail(reason: string): void;
};

class FakeManagedAgentSession implements FakeAgentSession {
	public constructor(private readonly options: FakeManagedAgentSessionOptions) {}

	public get reference(): AgentSessionReference {
		return this.options.getSnapshot().reference;
	}

	public getSnapshot(): FakeAgentSessionSnapshot {
		return this.options.getSnapshot();
	}

	public onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void } {
		return this.options.observe(listener);
	}

	public submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
		return this.options.submitPrompt(prompt);
	}

	public submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot> {
		return this.options.submitCommand(command);
	}

	public cancel(reason?: string): Promise<AgentSessionSnapshot> {
		return this.options.cancel(reason);
	}

	public terminate(reason?: string): Promise<AgentSessionSnapshot> {
		return this.options.terminate(reason);
	}

	public emitMessage(text: string, channel?: 'stdout' | 'stderr' | 'system' | 'agent'): void {
		this.options.emitMessage(text, channel);
	}

	public emitAwaitingInput(reason?: string): void {
		this.options.emitAwaitingInput(reason);
	}

	public overrideWorkingDirectory(workingDirectory: string): void {
		this.options.overrideWorkingDirectory(workingDirectory);
	}

	public complete(): void {
		this.options.complete();
	}

	public fail(reason: string): void {
		this.options.fail(reason);
	}
}

function now(): string {
	return new Date().toISOString();
}

function createSnapshot(
	request: AgentLaunchConfig,
	runnerId: string,
	sessionId: string,
	transportId?: string
): AgentSessionSnapshot {
	const timestamp = now();
	const transport = transportId === 'terminal'
		? {
			kind: 'terminal' as const,
			terminalSessionName: resolveTerminalSessionName(request, sessionId),
			paneId: 'terminal_44'
		}
		: undefined;
	const reference: AgentSessionReference = {
		runnerId,
		sessionId,
		...(transport ? { transport } : {})
	};
	return {
		runnerId,
		sessionId,
		workingDirectory: request.workingDirectory,
		taskId: request.task.taskId,
		missionId: request.missionId,
		stageId: request.task.stageId,
		status: 'running',
		attention: 'autonomous',
		progress: {
			state: 'working',
			updatedAt: timestamp
		},
		waitingForInput: false,
		acceptsPrompts: true,
		acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
		...(transport ? { transport } : {}),
		reference,
		startedAt: timestamp,
		updatedAt: timestamp
	};
}

function createDetachedSnapshot(runnerId: string, reference: AgentSessionReference, reason: string): AgentSessionSnapshot {
	const timestamp = now();
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
		acceptedCommands: [],
		reference: {
			runnerId,
			sessionId: reference.sessionId,
			...(reference.transport ? { transport: { ...reference.transport } } : {})
		},
		...(reference.transport ? { transport: { ...reference.transport } } : {}),
		failureMessage: reason,
		startedAt: timestamp,
		updatedAt: timestamp,
		endedAt: timestamp
	};
}

function buildCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
	switch (command.type) {
		case 'resume':
			return { source: 'system', text: command.reason?.trim() || 'Resume execution.' };
		case 'checkpoint':
			return {
				source: 'system',
				text: command.reason?.trim() || 'Provide a concise checkpoint, then continue with the task.'
			};
		case 'nudge':
			return { source: 'system', text: command.reason?.trim() || 'Continue with the assigned task.' };
	}
}

function toLegacySnapshot(snapshot: AgentSessionSnapshot, transportId?: string): FakeAgentSessionSnapshot {
	return {
		...snapshot,
		phase: snapshot.status,
		awaitingInput: snapshot.waitingForInput,
		...(transportId ? { transportId } : {}),
		...(snapshot.transport
			? {
				terminalSessionName: snapshot.transport.terminalSessionName,
				...(snapshot.transport.paneId ? { terminalPaneId: snapshot.transport.paneId } : {})
			}
			: {})
	};
}

function resolveTerminalSessionName(request: AgentLaunchConfig, sessionId: string): string {
	const value = request.metadata?.['terminalSessionName'];
	return typeof value === 'string' && value.trim() ? value.trim() : sessionId;
}

function cloneStartRequest(request: AgentLaunchConfig): FakeAgentStartRequest {
	const terminalSessionName = request.metadata?.['terminalSessionName'];
	return {
		...request,
		task: {
			...request.task,
			...(request.task.acceptanceCriteria ? { acceptanceCriteria: [...request.task.acceptanceCriteria] } : {})
		},
		specification: {
			summary: request.specification.summary,
			documents: request.specification.documents.map((document) => ({ ...document }))
		},
		resume: { ...request.resume },
		...(request.initialPrompt
			? {
				initialPrompt: {
					...request.initialPrompt,
					...(request.initialPrompt.metadata ? { metadata: { ...request.initialPrompt.metadata } } : {})
				}
			}
			: {}),
		...(request.metadata ? { metadata: { ...request.metadata } } : {}),
		...(typeof terminalSessionName === 'string' && terminalSessionName.trim()
			? { terminalSessionName: terminalSessionName.trim() }
			: {})
	};
}