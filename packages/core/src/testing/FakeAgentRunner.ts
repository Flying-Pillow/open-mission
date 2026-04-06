import type { AgentRunner } from '../runtime/AgentRunner.js';
import type { AgentSession } from '../runtime/AgentSession.js';
import type {
	AgentCommand,
	AgentPrompt,
	AgentSessionEvent,
	AgentSessionReference,
	AgentSessionSnapshot,
	AgentSessionStartRequest
} from '../runtime/AgentRuntimeTypes.js';

type Listener = (event: AgentSessionEvent) => void;

class FakeAgentSession implements AgentSession {
	private snapshot: AgentSessionSnapshot;
	private readonly listeners = new Set<Listener>();

	public constructor(snapshot: AgentSessionSnapshot) {
		this.snapshot = { ...snapshot, acceptedCommands: [...snapshot.acceptedCommands] };
	}

	public get runnerId(): string {
		return this.snapshot.runnerId;
	}

	public get sessionId(): string {
		return this.snapshot.sessionId;
	}

	public getSnapshot(): AgentSessionSnapshot {
		return {
			...this.snapshot,
			acceptedCommands: [...this.snapshot.acceptedCommands]
		};
	}

	public onDidEvent(listener: Listener): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			}
		};
	}

	public async submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
		this.emit({
			type: 'prompt.accepted',
			prompt,
			snapshot: this.nextSnapshot({
				phase: 'running',
				awaitingInput: false
			})
		});
		return this.getSnapshot();
	}

	public async submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot> {
		this.emit({
			type: 'command.accepted',
			command,
			snapshot: this.nextSnapshot({
				phase: command.kind === 'finish' ? 'completed' : 'running',
				awaitingInput: false
			})
		});
		if (command.kind === 'finish') {
			this.emit({
				type: 'session.completed',
				snapshot: this.getSnapshot()
			});
		}
		return this.getSnapshot();
	}

	public async cancel(reason?: string): Promise<AgentSessionSnapshot> {
		this.emit({
			type: 'session.cancelled',
			...(reason ? { reason } : {}),
			snapshot: this.nextSnapshot({
				phase: 'cancelled',
				awaitingInput: false
			})
		});
		return this.getSnapshot();
	}

	public async terminate(reason?: string): Promise<AgentSessionSnapshot> {
		this.emit({
			type: 'session.terminated',
			...(reason ? { reason } : {}),
			snapshot: this.nextSnapshot({
				phase: 'terminated',
				awaitingInput: false,
				acceptsPrompts: false
			})
		});
		return this.getSnapshot();
	}

	public dispose(): void {
		this.listeners.clear();
	}

	public emitMessage(text: string, channel: 'stdout' | 'stderr' | 'system' | 'agent' = 'stdout'): void {
		this.emit({
			type: 'session.message',
			channel,
			text,
			snapshot: this.nextSnapshot({ phase: 'running' })
		});
	}

	public emitAwaitingInput(): void {
		this.emit({
			type: 'session.awaiting-input',
			snapshot: this.nextSnapshot({
				phase: 'awaiting-input',
				awaitingInput: true
			})
		});
	}

	private emit(event: AgentSessionEvent): void {
		this.snapshot = {
			...event.snapshot,
			acceptedCommands: [...event.snapshot.acceptedCommands]
		};
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private nextSnapshot(
		overrides: Partial<AgentSessionSnapshot>
	): AgentSessionSnapshot {
		return {
			...this.snapshot,
			...overrides,
			updatedAt: new Date().toISOString(),
			acceptedCommands: overrides.acceptedCommands
				? [...overrides.acceptedCommands]
				: [...this.snapshot.acceptedCommands]
		};
	}
}

export class FakeAgentRunner implements AgentRunner {
	private readonly sessions = new Map<string, FakeAgentSession>();
	private nextSessionId = 0;

	public readonly capabilities = {
		attachableSessions: true,
		promptSubmission: true,
		structuredCommands: true,
		interruptible: true,
		interactiveInput: true,
		telemetry: false,
		mcpClient: false
	} as const;

	public constructor(
		public readonly id: string,
		public readonly displayName: string
	) { }

	public async isAvailable(): Promise<{ available: true }> {
		return { available: true };
	}

	public async startSession(request: AgentSessionStartRequest): Promise<AgentSession> {
		const sessionId = `${this.id}-session-${String(++this.nextSessionId)}`;
		const session = new FakeAgentSession({
			runnerId: this.id,
			sessionId,
			phase: 'running',
			workingDirectory: request.workingDirectory,
			taskId: request.taskId,
			missionId: request.missionId,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt', 'continue', 'checkpoint', 'finish'],
			awaitingInput: false,
			updatedAt: new Date().toISOString()
		});
		this.sessions.set(sessionId, session);
		return session;
	}

	public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
		const session = this.sessions.get(reference.sessionId);
		if (!session) {
			throw new Error(`Fake session '${reference.sessionId}' does not exist.`);
		}
		return session;
	}

	public async listSessions(): Promise<AgentSessionSnapshot[]> {
		return [...this.sessions.values()].map((session) => session.getSnapshot());
	}

	public getSession(sessionId: string): FakeAgentSession | undefined {
		return this.sessions.get(sessionId);
	}
}