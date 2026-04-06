import { describe, expect, it } from 'vitest';
import type { AgentRunner } from './AgentRunner.js';
import type { AgentSession } from './AgentSession.js';
import { AgentSessionOrchestrator } from './AgentSessionOrchestrator.js';
import type { PersistedAgentSessionStore } from './PersistedAgentSessionStore.js';
import type {
    AgentCommand,
    AgentPrompt,
    AgentSessionEvent,
    AgentSessionReference,
    AgentSessionSnapshot,
    AgentSessionStartRequest
} from './AgentRuntimeTypes.js';

type Listener = (event: AgentSessionEvent) => void;

class FakeSession implements AgentSession {
    public readonly runnerId: string;
    public readonly sessionId: string;
    private snapshot: AgentSessionSnapshot;
    private readonly listeners = new Set<Listener>();

    public constructor(snapshot: AgentSessionSnapshot) {
        this.runnerId = snapshot.runnerId;
        this.sessionId = snapshot.sessionId;
        this.snapshot = { ...snapshot };
    }

    public getSnapshot(): AgentSessionSnapshot {
        return { ...this.snapshot, acceptedCommands: [...this.snapshot.acceptedCommands] };
    }

    public onDidEvent(listener: Listener): { dispose(): void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    }

    public async submitPrompt(_prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public async submitCommand(_command: AgentCommand): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public async cancel(): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public async terminate(): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public dispose(): void {
        this.listeners.clear();
    }

    public emit(event: AgentSessionEvent): void {
        this.snapshot = {
            ...event.snapshot,
            acceptedCommands: [...event.snapshot.acceptedCommands]
        };
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

class InMemorySessionStore implements PersistedAgentSessionStore {
    public readonly references: AgentSessionReference[] = [];
    public readonly snapshots = new Map<string, AgentSessionSnapshot>();

    public async list(): Promise<AgentSessionReference[]> {
        return [...this.references];
    }

    public async load(reference: AgentSessionReference): Promise<AgentSessionSnapshot | undefined> {
        return this.snapshots.get(reference.sessionId);
    }

    public async save(snapshot: AgentSessionSnapshot): Promise<void> {
        this.snapshots.set(snapshot.sessionId, {
            ...snapshot,
            acceptedCommands: [...snapshot.acceptedCommands]
        });
    }

    public async delete(reference: AgentSessionReference): Promise<void> {
        this.snapshots.delete(reference.sessionId);
    }
}

function createStartRequest(): AgentSessionStartRequest {
    return {
        missionId: 'mission-1',
        taskId: 'task-1',
        workingDirectory: '/tmp/work',
        initialPrompt: {
            source: 'engine',
            text: 'Complete the task.'
        }
    };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('AgentSessionOrchestrator', () => {
    it('retains mission/task identity when session events omit identity fields', async () => {
        const store = new InMemorySessionStore();
        let fakeSession: FakeSession | undefined;

        const runner: AgentRunner = {
            id: 'fake-runner',
            displayName: 'Fake Runner',
            capabilities: {
                attachableSessions: false,
                promptSubmission: true,
                structuredCommands: true,
                interruptible: true,
                interactiveInput: false,
                telemetry: false,
                mcpClient: false
            },
            isAvailable: async () => ({ available: true }),
            startSession: async () => {
                fakeSession = new FakeSession({
                    runnerId: 'fake-runner',
                    sessionId: 'session-1',
                    missionId: 'mission-1',
                    taskId: 'task-1',
                    phase: 'running',
                    acceptsPrompts: true,
                    acceptedCommands: ['interrupt'],
                    awaitingInput: false,
                    updatedAt: new Date().toISOString()
                });
                return fakeSession;
            }
        };

        const orchestrator = new AgentSessionOrchestrator({
            runners: [runner],
            store
        });
        const observed: AgentSessionEvent[] = [];
        orchestrator.onDidEvent((event) => {
            observed.push(event);
        });

        await orchestrator.startSession('fake-runner', createStartRequest());
        fakeSession?.emit({
            type: 'session.state-changed',
            snapshot: {
                runnerId: 'fake-runner',
                sessionId: 'session-1',
                missionId: '',
                taskId: '',
                phase: 'running',
                acceptsPrompts: true,
                acceptedCommands: ['interrupt'],
                awaitingInput: false,
                updatedAt: new Date().toISOString()
            }
        });
        await flushMicrotasks();

        expect(observed).toHaveLength(1);
        expect(observed[0]?.snapshot.missionId).toBe('mission-1');
        expect(observed[0]?.snapshot.taskId).toBe('task-1');

        const snapshot = orchestrator.listSessions()[0];
        expect(snapshot?.missionId).toBe('mission-1');
        expect(snapshot?.taskId).toBe('task-1');

        const persisted = store.snapshots.get('session-1');
        expect(persisted?.missionId).toBe('mission-1');
        expect(persisted?.taskId).toBe('task-1');
    });

    it('materializes a terminated attachment when a runner cannot attach sessions', async () => {
        const store = new InMemorySessionStore();

        const runner: AgentRunner = {
            id: 'fake-runner',
            displayName: 'Fake Runner',
            capabilities: {
                attachableSessions: false,
                promptSubmission: true,
                structuredCommands: true,
                interruptible: true,
                interactiveInput: false,
                telemetry: false,
                mcpClient: false
            },
            isAvailable: async () => ({ available: true }),
            startSession: async () => {
                throw new Error('unused in this test');
            }
        };

        const orchestrator = new AgentSessionOrchestrator({
            runners: [runner],
            store
        });
        const observed: AgentSessionEvent[] = [];
        orchestrator.onDidEvent((event) => {
            observed.push(event);
        });

        const attached = await orchestrator.attachSession({
            runnerId: 'fake-runner',
            sessionId: 'session-missing'
        });

        const snapshot = attached.getSnapshot();
        expect(snapshot.phase).toBe('terminated');
        expect(snapshot.acceptsPrompts).toBe(false);
        expect(snapshot.failureMessage).toContain('no longer exists');

        expect(observed).toHaveLength(1);
        expect(observed[0]?.type).toBe('session.terminated');
        expect(observed[0]?.snapshot.sessionId).toBe('session-missing');

        const persisted = store.snapshots.get('session-missing');
        expect(persisted?.phase).toBe('terminated');
    });
});
