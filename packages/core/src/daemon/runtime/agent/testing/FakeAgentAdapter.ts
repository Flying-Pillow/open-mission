import type { AgentExecution } from '../../../../entities/AgentExecution/AgentExecution.js';
import { AgentAdapter } from '../AgentAdapter.js';
import type {
	AgentCommand,
	AgentLaunchConfig,
	AgentPrompt,
	AgentCapabilities,
	AgentExecutionEvent,
	AgentExecutionReference,
	AgentExecutionSnapshot
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export type FakeAgentExecutionSnapshot = AgentExecutionSnapshot & {
	phase: AgentExecutionSnapshot['status'];
	awaitingInput: boolean;
	transportId?: string;
	terminalName?: string;
	terminalPaneId?: string;
};

export type FakeAgentStartRequest = AgentLaunchConfig & {
	terminalName?: string;
};

export interface FakeAgentExecution {
	reference: AgentExecutionReference;
	getSnapshot(): FakeAgentExecutionSnapshot;
	onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void };
	done(): Promise<AgentExecutionSnapshot>;
	submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
	submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
	cancel(reason?: string): Promise<AgentExecutionSnapshot>;
	terminate(reason?: string): Promise<AgentExecutionSnapshot>;
	emitMessage(text: string, channel?: 'stdout' | 'stderr' | 'system' | 'agent'): void;
	emitAwaitingInput(reason?: string): void;
	overrideWorkingDirectory(workingDirectory: string): void;
	cancelRuntime(reason?: string): Promise<AgentExecutionSnapshot>;
	terminateRuntime(reason?: string): Promise<AgentExecutionSnapshot>;
	fail(reason: string): void;
}

type SnapshotOverrides = Omit<Partial<AgentExecutionSnapshot>, 'failureMessage'> & {
	failureMessage?: string | undefined;
};

type FakeAgentExecutionRecord = {
	snapshot: AgentExecutionSnapshot;
	listeners: Set<(event: AgentExecutionEvent) => void>;
};

export class FakeAgentAdapter extends AgentAdapter {
	private readonly agentExecutionIds = new Set<string>();
	private readonly records = new Map<string, FakeAgentExecutionRecord>();
	private readonly startRequests: FakeAgentStartRequest[] = [];
	private nextAgentExecutionId = 0;

	public constructor(
		id: string,
		displayName: string,
		private readonly transportId?: string
	) {
		super({
			id,
			displayName,
			command: 'fake-agent',
			createLaunchPlan: () => ({ mode: 'interactive', command: 'fake-agent', args: [] })
		});
	}

	public override async getCapabilities(): Promise<AgentCapabilities> {
		return {
			acceptsPromptSubmission: true,
			acceptsCommands: true,
			supportsInterrupt: true,
			supportsResumeByReference: true,
			supportsCheckpoint: true,
			shareModes: this.transportId === 'terminal' ? ['terminal'] : []
		};
	}

	public override async isAvailable(): Promise<{ available: boolean; reason?: string }> {
		return { available: true };
	}

	public async startExecution(config: AgentLaunchConfig): Promise<AgentExecution> {
		const agentExecutionId = `${this.id}-AgentExecution-${String(++this.nextAgentExecutionId)}`;
		const snapshot = createSnapshot(config, this.id, agentExecutionId, this.transportId);
		this.startRequests.push(cloneStartRequest(config));
		this.agentExecutionIds.add(agentExecutionId);
		this.records.set(agentExecutionId, { snapshot, listeners: new Set() });
		return this.createInspectableAgentExecution(agentExecutionId) as unknown as AgentExecution;
	}

	public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecution> {
		if (this.agentExecutionIds.has(reference.agentExecutionId)) {
			return this.createInspectableAgentExecution(reference.agentExecutionId) as unknown as AgentExecution;
		}
		return createDetachedExecution(createDetachedSnapshot(this.id, reference, 'AgentExecution no longer exists in fake runtime.'));
	}

	public listExecutions(): FakeAgentExecution[] {
		return [...this.agentExecutionIds].map((agentExecutionId) => this.createInspectableAgentExecution(agentExecutionId));
	}

	public getAgentExecution(agentExecutionId: string): FakeAgentExecution | undefined {
		return this.agentExecutionIds.has(agentExecutionId) ? this.createInspectableAgentExecution(agentExecutionId) : undefined;
	}

	public deleteAgentExecution(agentExecutionId: string): void {
		if (!this.agentExecutionIds.has(agentExecutionId)) {
			return;
		}
		this.agentExecutionIds.delete(agentExecutionId);
		this.records.delete(agentExecutionId);
	}

	public overrideAgentExecutionWorkingDirectory(agentExecutionId: string, workingDirectory: string): void {
		this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.updated',
			snapshot: this.requireSnapshot(agentExecutionId)
		});
	}

	public getLastStartRequest(): FakeAgentStartRequest | undefined {
		const request = this.startRequests.at(-1);
		return request ? cloneStartRequest(request) : undefined;
	}

	private createInspectableAgentExecution(agentExecutionId: string): FakeAgentExecution {
		return new FakeManagedAgentExecution({
			getSnapshot: () => toLegacySnapshot(this.requireSnapshot(agentExecutionId), this.transportId),
			observe: (listener) => this.observeAgentExecution(agentExecutionId, listener),
			done: () => this.completeAgentExecution(agentExecutionId),
			submitPrompt: (prompt) => this.submitPrompt(agentExecutionId, prompt),
			submitCommand: (command) => this.submitCommand(agentExecutionId, command),
			cancel: (reason) => this.cancelAgentExecution(agentExecutionId, reason),
			terminate: (reason) => this.terminateAgentExecution(agentExecutionId, reason),
			cancelRuntime: (reason) => this.cancelAgentExecution(agentExecutionId, reason),
			terminateRuntime: (reason) => this.terminateAgentExecution(agentExecutionId, reason),
			emitMessage: (text, channel) => this.emitMessage(agentExecutionId, text, channel),
			emitAwaitingInput: (reason) => this.emitAwaitingInput(agentExecutionId, reason),
			overrideWorkingDirectory: (workingDirectory) => this.overrideAgentExecutionWorkingDirectory(agentExecutionId, workingDirectory),
			complete: () => this.completeAgentExecution(agentExecutionId),
			fail: (reason) => this.failAgentExecution(agentExecutionId, reason)
		});
	}

	private async submitPrompt(agentExecutionId: string, _prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
		const snapshot = this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.updated',
			snapshot
		});
		return snapshot;
	}

	private async submitCommand(agentExecutionId: string, command: AgentCommand): Promise<AgentExecutionSnapshot> {
		if (command.type === 'interrupt') {
			const snapshot = this.updateSnapshot(agentExecutionId, {
				status: 'running',
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
			this.emitExecutionEvent({
				type: 'execution.updated',
				snapshot
			});
			return snapshot;
		}

		return this.submitPrompt(agentExecutionId, buildCommandPrompt(command));
	}

	private async cancelAgentExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
		const endedAt = now();
		const snapshot = this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.cancelled',
			...(reason ? { reason } : {}),
			snapshot
		});
		return snapshot;
	}

	private async terminateAgentExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
		const endedAt = now();
		const snapshot = this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.terminated',
			...(reason ? { reason } : {}),
			snapshot
		});
		return snapshot;
	}

	private emitMessage(
		agentExecutionId: string,
		text: string,
		channel: 'stdout' | 'stderr' | 'system' | 'agent' = 'stdout'
	): void {
		const snapshot = this.updateSnapshot(agentExecutionId, {
			status: 'running',
			attention: 'autonomous',
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.emitExecutionEvent({
			type: 'execution.message',
			channel,
			text,
			snapshot
		});
	}

	private emitAwaitingInput(agentExecutionId: string, reason?: string): void {
		const snapshot = this.updateSnapshot(agentExecutionId, {
			status: 'running',
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
		this.emitExecutionEvent({
			type: 'execution.updated',
			snapshot
		});
	}

	private async completeAgentExecution(agentExecutionId: string): Promise<AgentExecutionSnapshot> {
		const endedAt = now();
		const snapshot = this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.completed',
			snapshot
		});
		return snapshot;
	}

	private failAgentExecution(agentExecutionId: string, reason: string): void {
		const endedAt = now();
		const snapshot = this.updateSnapshot(agentExecutionId, {
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
		this.emitExecutionEvent({
			type: 'execution.failed',
			reason,
			snapshot
		});
	}

	private updateSnapshot(agentExecutionId: string, overrides: SnapshotOverrides): AgentExecutionSnapshot {
		const record = this.requireRecord(agentExecutionId);
		const nextSnapshot: AgentExecutionSnapshot = {
			...record.snapshot,
			acceptedCommands: overrides.acceptedCommands
				? [...overrides.acceptedCommands]
				: [...record.snapshot.acceptedCommands],
			progress: overrides.progress
				? { ...overrides.progress, ...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {}) }
				: { ...record.snapshot.progress, ...(record.snapshot.progress.units ? { units: { ...record.snapshot.progress.units } } : {}) },
			reference: overrides.reference
				? { ...overrides.reference, ...(overrides.reference.transport ? { transport: { ...overrides.reference.transport } } : {}) }
				: { ...record.snapshot.reference, ...(record.snapshot.reference.transport ? { transport: { ...record.snapshot.reference.transport } } : {}) },
			updatedAt: now()
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
		record.snapshot = nextSnapshot;
		return cloneSnapshot(record.snapshot);
	}

	private requireRecord(agentExecutionId: string): FakeAgentExecutionRecord {
		const record = this.records.get(agentExecutionId);
		if (!record) {
			throw new Error(`Fake agent execution '${agentExecutionId}' is not attached.`);
		}
		return record;
	}

	private requireSnapshot(agentExecutionId: string): AgentExecutionSnapshot {
		return cloneSnapshot(this.requireRecord(agentExecutionId).snapshot);
	}

	private observeAgentExecution(agentExecutionId: string, listener: (event: AgentExecutionEvent) => void): { dispose(): void } {
		const record = this.requireRecord(agentExecutionId);
		record.listeners.add(listener);
		return {
			dispose: () => {
				record.listeners.delete(listener);
			}
		};
	}

	private emitExecutionEvent(event: AgentExecutionEvent): void {
		const record = this.records.get(event.snapshot.agentExecutionId);
		if (!record) {
			return;
		}
		record.snapshot = cloneSnapshot(event.snapshot);
		for (const listener of record.listeners) {
			listener(event);
		}
	}
}

type FakeManagedAgentExecutionOptions = {
	getSnapshot(): FakeAgentExecutionSnapshot;
	observe(listener: (event: AgentExecutionEvent) => void): { dispose(): void };
	done(): Promise<AgentExecutionSnapshot>;
	submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
	submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
	cancel(reason?: string): Promise<AgentExecutionSnapshot>;
	terminate(reason?: string): Promise<AgentExecutionSnapshot>;
	emitMessage(text: string, channel?: 'stdout' | 'stderr' | 'system' | 'agent'): void;
	emitAwaitingInput(reason?: string): void;
	overrideWorkingDirectory(workingDirectory: string): void;
	complete(): Promise<AgentExecutionSnapshot>;
	cancelRuntime(reason?: string): Promise<AgentExecutionSnapshot>;
	terminateRuntime(reason?: string): Promise<AgentExecutionSnapshot>;
	fail(reason: string): void;
};

class FakeManagedAgentExecution implements FakeAgentExecution {
	public constructor(private readonly options: FakeManagedAgentExecutionOptions) { }

	public get agentExecutionId(): string {
		return this.options.getSnapshot().agentExecutionId;
	}

	public get reference(): AgentExecutionReference {
		return this.options.getSnapshot().reference;
	}

	public getSnapshot(): FakeAgentExecutionSnapshot {
		return this.options.getSnapshot();
	}

	public onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void } {
		return this.options.observe(listener);
	}

	public done(): Promise<AgentExecutionSnapshot> {
		return this.options.done();
	}

	public submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
		return this.options.submitPrompt(prompt);
	}

	public submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot> {
		return this.options.submitCommand(command);
	}

	public cancel(reason?: string): Promise<AgentExecutionSnapshot> {
		return this.options.cancel(reason);
	}

	public terminate(reason?: string): Promise<AgentExecutionSnapshot> {
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

	public complete(): Promise<AgentExecutionSnapshot> {
		return this.options.complete();
	}

	public cancelRuntime(reason?: string): Promise<AgentExecutionSnapshot> {
		return this.options.cancelRuntime(reason);
	}

	public terminateRuntime(reason?: string): Promise<AgentExecutionSnapshot> {
		return this.options.terminateRuntime(reason);
	}

	public fail(reason: string): void {
		this.options.fail(reason);
	}

	public replaceJournalRecords(): void {
		return;
	}

	public setAwaitingResponseToMessageId(): void {
		return;
	}
}

function createDetachedExecution(snapshot: AgentExecutionSnapshot): AgentExecution {
	return new FakeManagedAgentExecution({
		getSnapshot: () => toLegacySnapshot(snapshot),
		observe: () => ({ dispose() { } }),
		done: async () => cloneSnapshot(snapshot),
		submitPrompt: async () => {
			throw new Error(`Fake agent execution '${snapshot.agentExecutionId}' is no longer available.`);
		},
		submitCommand: async () => {
			throw new Error(`Fake agent execution '${snapshot.agentExecutionId}' is no longer available.`);
		},
		cancel: async () => cloneSnapshot(snapshot),
		terminate: async () => cloneSnapshot(snapshot),
		cancelRuntime: async () => cloneSnapshot(snapshot),
		terminateRuntime: async () => cloneSnapshot(snapshot),
		emitMessage: () => undefined,
		emitAwaitingInput: () => undefined,
		overrideWorkingDirectory: () => undefined,
		complete: async () => cloneSnapshot(snapshot),
		fail: () => undefined
	}) as unknown as AgentExecution;
}

function cloneSnapshot(snapshot: AgentExecutionSnapshot): AgentExecutionSnapshot {
	return {
		...snapshot,
		acceptedCommands: [...snapshot.acceptedCommands],
		progress: {
			...snapshot.progress,
			...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {})
		},
		reference: {
			...snapshot.reference,
			...(snapshot.reference.transport ? { transport: { ...snapshot.reference.transport } } : {})
		},
		...(snapshot.transport ? { transport: { ...snapshot.transport } } : {})
	};
}

function now(): string {
	return new Date().toISOString();
}

function createSnapshot(
	request: AgentLaunchConfig,
	agentId: string,
	agentExecutionId: string,
	transportId?: string
): AgentExecutionSnapshot {
	const timestamp = now();
	const transport = transportId === 'terminal'
		? {
			kind: 'terminal' as const,
			terminalName: resolveTerminalName(request, agentExecutionId),
			terminalPaneId: 'terminal_44'
		}
		: undefined;
	const reference: AgentExecutionReference = {
		agentId,
		agentExecutionId: agentExecutionId,
		...(transport ? { transport } : {})
	};
	return {
		agentId,
		agentExecutionId: agentExecutionId,
		scope: request.scope,
		workingDirectory: request.workingDirectory,
		...(request.task?.taskId ? { taskId: request.task.taskId } : {}),
		...(request.scope.kind === 'mission' || request.scope.kind === 'task' || request.scope.kind === 'artifact'
			? request.scope.missionId ? { missionId: request.scope.missionId } : {}
			: {}),
		...(request.task?.stageId ? { stageId: request.task.stageId } : {}),
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

function createDetachedSnapshot(agentId: string, reference: AgentExecutionReference, reason: string): AgentExecutionSnapshot {
	const timestamp = now();
	return {
		agentId,
		agentExecutionId: reference.agentExecutionId,
		scope: { kind: 'system', label: 'detached' },
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
			agentId,
			agentExecutionId: reference.agentExecutionId,
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
	throw new Error(`Unsupported AgentExecution command '${String((command as { type: string }).type)}'.`);
}

function toLegacySnapshot(snapshot: AgentExecutionSnapshot, transportId?: string): FakeAgentExecutionSnapshot {
	return {
		...snapshot,
		phase: snapshot.status,
		awaitingInput: snapshot.waitingForInput,
		...(transportId ? { transportId } : {}),
		...(snapshot.transport
			? {
				terminalName: snapshot.transport.terminalName,
				...(snapshot.transport.terminalPaneId ? { terminalPaneId: snapshot.transport.terminalPaneId } : {})
			}
			: {})
	};
}

function resolveTerminalName(request: AgentLaunchConfig, agentExecutionId: string): string {
	const value = request.metadata?.['terminalName'];
	return typeof value === 'string' && value.trim() ? value.trim() : agentExecutionId;
}

function cloneStartRequest(request: AgentLaunchConfig): FakeAgentStartRequest {
	const terminalName = request.metadata?.['terminalName'];
	return {
		...request,
		...(request.task
			? {
				task: {
					...request.task,
					...(request.task.acceptanceCriteria ? { acceptanceCriteria: [...request.task.acceptanceCriteria] } : {})
				}
			}
			: {}),
		...(request.specification
			? {
				specification: {
					summary: request.specification.summary,
					documents: request.specification.documents.map((document) => ({ ...document }))
				}
			}
			: {}),
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
		...(typeof terminalName === 'string' && terminalName.trim()
			? { terminalName: terminalName.trim() }
			: {})
	};
}
