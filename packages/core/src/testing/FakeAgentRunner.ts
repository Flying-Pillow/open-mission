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

type Listener = (event: AgentSessionEvent) => void;

function now(): string {
	return new Date().toISOString();
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

function createSnapshot(request: AgentLaunchRequest, runnerId: string, sessionId: string): AgentSessionSnapshot {
	const timestamp = now();
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
		acceptedActions: ['pause', 'checkpoint', 'nudge', 'finish'],
		startedAt: timestamp,
		updatedAt: timestamp
	};
}

function updateSnapshot(
	snapshot: AgentSessionSnapshot,
	overrides: Partial<AgentSessionSnapshot>
): AgentSessionSnapshot {
	const updatedAt = now();
	return {
		...snapshot,
		...overrides,
		acceptedActions: overrides.acceptedActions
			? [...overrides.acceptedActions]
			: [...snapshot.acceptedActions],
		progress: overrides.progress
			? {
				...overrides.progress,
				...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {}),
				updatedAt: overrides.progress.updatedAt ?? updatedAt
			}
			: {
				...snapshot.progress,
				...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {}),
				updatedAt
			},
		updatedAt
	};
}

function buildSteerPrompt(action: AgentSteerAction, reason?: string): AgentPrompt | undefined {
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
			return undefined;
	}
}

export class FakeAgentRunner implements AgentRunner {
	private readonly sessions = new Map<string, AgentSessionSnapshot>();
	private readonly listeners = new Set<Listener>();
	private readonly launchRequests: AgentLaunchRequest[] = [];
	private nextSessionId = 0;

	public constructor(
		public readonly id: string,
		public readonly displayName: string
	) {}

	public async checkAvailability(): Promise<{ available: true }> {
		return { available: true };
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
		this.launchRequests.push(cloneLaunchRequest(request));
		const sessionId = `${this.id}-session-${String(++this.nextSessionId)}`;
		const snapshot = createSnapshot(request, this.id, sessionId);
		this.sessions.set(sessionId, snapshot);
		return cloneSnapshot(snapshot);
	}

	public async attach(reference: AgentSessionReference): Promise<AgentSessionSnapshot> {
		const snapshot = this.sessions.get(reference.sessionId);
		if (!snapshot) {
			const timestamp = now();
			return {
				runnerId: this.id,
				sessionId: reference.sessionId,
				workingDirectory: 'unknown',
				taskId: 'unknown',
				missionId: 'unknown',
				stageId: 'unknown',
				status: 'terminated',
				attention: 'none',
				progress: {
					state: 'failed',
					detail: 'Session no longer exists in fake runtime.',
					updatedAt: timestamp
				},
				waitingForInput: false,
				acceptsPrompts: false,
				acceptedActions: [],
				failureMessage: 'Session no longer exists in fake runtime.',
				startedAt: timestamp,
				updatedAt: timestamp,
				endedAt: timestamp,
				...(reference.transport ? { transport: { ...reference.transport } } : {})
			};
		}
		return cloneSnapshot(snapshot);
	}

	public async list(): Promise<AgentSessionSnapshot[]> {
		return [...this.sessions.values()].map((snapshot) => cloneSnapshot(snapshot));
	}

	public async prompt(sessionId: string, _prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
		const snapshot = this.requireSession(sessionId);
		const next = updateSnapshot(snapshot, {
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			acceptsPrompts: true,
			acceptedActions: ['pause', 'checkpoint', 'nudge', 'finish'],
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.updated', snapshot: cloneSnapshot(next) });
		return cloneSnapshot(next);
	}

	public async steer(
		sessionId: string,
		action: AgentSteerAction,
		options?: { reason?: string; metadata?: Record<string, AgentRuntimePrimitive> }
	): Promise<AgentSessionSnapshot> {
		const snapshot = this.requireSession(sessionId);
		if (action === 'pause') {
			const next = updateSnapshot(snapshot, {
				status: 'awaiting-input',
				attention: 'awaiting-system',
				waitingForInput: true,
				acceptedActions: ['resume', 'checkpoint', 'nudge', 'finish'],
				progress: {
					state: 'waiting-input',
					detail: options?.reason,
					updatedAt: now()
				}
			});
			this.sessions.set(sessionId, next);
			this.emit({ type: 'session.awaiting-input', snapshot: cloneSnapshot(next) });
			return cloneSnapshot(next);
		}

		const prompt = buildSteerPrompt(action, options?.reason);
		if (!prompt) {
			throw new Error(`Unsupported steer action '${action}'.`);
		}
		return this.prompt(sessionId, prompt);
	}

	public async cancel(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const snapshot = this.requireSession(sessionId);
		const endedAt = now();
		const next = updateSnapshot(snapshot, {
			status: 'cancelled',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedActions: [],
			endedAt,
			failureMessage: reason,
			progress: {
				state: 'done',
				detail: reason,
				updatedAt: endedAt
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({
			type: 'session.cancelled',
			...(reason ? { reason } : {}),
			snapshot: cloneSnapshot(next)
		});
		return cloneSnapshot(next);
	}

	public async terminate(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
		const snapshot = this.requireSession(sessionId);
		const endedAt = now();
		const next = updateSnapshot(snapshot, {
			status: 'terminated',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedActions: [],
			endedAt,
			failureMessage: reason,
			progress: {
				state: 'failed',
				detail: reason,
				updatedAt: endedAt
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({
			type: 'session.terminated',
			...(reason ? { reason } : {}),
			snapshot: cloneSnapshot(next)
		});
		return cloneSnapshot(next);
	}

	public getSession(sessionId: string): AgentSessionSnapshot | undefined {
		const snapshot = this.sessions.get(sessionId);
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	public deleteSession(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	public emitMessage(
		sessionId: string,
		text: string,
		channel: 'stdout' | 'stderr' | 'system' | 'agent' = 'stdout'
	): void {
		const snapshot = this.requireSession(sessionId);
		const next = updateSnapshot(snapshot, {
			status: 'running',
			attention: 'autonomous',
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.message', channel, text, snapshot: cloneSnapshot(next) });
	}

	public emitAwaitingInput(sessionId: string): void {
		const snapshot = this.requireSession(sessionId);
		const next = updateSnapshot(snapshot, {
			status: 'awaiting-input',
			attention: 'awaiting-operator',
			waitingForInput: true,
			acceptedActions: ['resume', 'checkpoint', 'nudge', 'finish'],
			progress: {
				state: 'waiting-input',
				updatedAt: now()
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.awaiting-input', snapshot: cloneSnapshot(next) });
	}

	public overrideWorkingDirectory(sessionId: string, workingDirectory: string): void {
		const snapshot = this.requireSession(sessionId);
		const next = updateSnapshot(snapshot, {
			workingDirectory,
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			progress: {
				state: 'working',
				updatedAt: now()
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.updated', snapshot: cloneSnapshot(next) });
	}

	public complete(sessionId: string): void {
		const snapshot = this.requireSession(sessionId);
		const endedAt = now();
		const next = updateSnapshot(snapshot, {
			status: 'completed',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedActions: [],
			endedAt,
			progress: {
				state: 'done',
				updatedAt: endedAt
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.completed', snapshot: cloneSnapshot(next) });
	}

	public fail(sessionId: string, reason: string): void {
		const snapshot = this.requireSession(sessionId);
		const endedAt = now();
		const next = updateSnapshot(snapshot, {
			status: 'failed',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedActions: [],
			endedAt,
			failureMessage: reason,
			progress: {
				state: 'failed',
				detail: reason,
				updatedAt: endedAt
			}
		});
		this.sessions.set(sessionId, next);
		this.emit({ type: 'session.failed', reason, snapshot: cloneSnapshot(next) });
	}

	public getLastLaunchRequest(): AgentLaunchRequest | undefined {
		const request = this.launchRequests.at(-1);
		return request ? cloneLaunchRequest(request) : undefined;
	}

	private requireSession(sessionId: string): AgentSessionSnapshot {
		const snapshot = this.sessions.get(sessionId);
		if (!snapshot) {
			throw new Error(`Fake session '${sessionId}' does not exist.`);
		}
		return snapshot;
	}

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

function cloneLaunchRequest(request: AgentLaunchRequest): AgentLaunchRequest {
	return {
		...request,
		task: {
			...request.task,
			...(request.task.acceptanceCriteria
				? { acceptanceCriteria: [...request.task.acceptanceCriteria] }
				: {})
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
					...(request.initialPrompt.metadata
						? { metadata: { ...request.initialPrompt.metadata } }
						: {})
				}
			}
			: {}),
		...(request.metadata ? { metadata: { ...request.metadata } } : {})
	};
}