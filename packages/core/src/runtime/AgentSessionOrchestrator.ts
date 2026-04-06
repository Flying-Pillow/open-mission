import type { AgentRunner } from './AgentRunner.js';
import type { AgentSession } from './AgentSession.js';
import { AgentSessionEventEmitter } from './AgentSessionEventEmitter.js';
import type { PersistedAgentSessionStore } from './PersistedAgentSessionStore.js';
import type {
    AgentCommand,
    AgentPrompt,
    AgentRunnerId,
    AgentSessionEvent,
    AgentSessionId,
    AgentSessionReference,
    AgentSessionSnapshot,
    AgentSessionStartRequest,
    McpServerReference
} from './AgentRuntimeTypes.js';

type OrchestratorSessionRecord = {
    reference: AgentSessionReference;
    session: AgentSession;
    snapshot: AgentSessionSnapshot;
    subscription: { dispose(): void };
};

export class AgentSessionOrchestrator {
    private readonly runners = new Map<AgentRunnerId, AgentRunner>();
    private readonly sessions = new Map<AgentSessionId, OrchestratorSessionRecord>();
    private readonly mcpServerProvider: (() => Promise<McpServerReference[]>) | undefined;
    private readonly store: PersistedAgentSessionStore | undefined;
    private readonly eventEmitter = new AgentSessionEventEmitter<AgentSessionEvent>();

    public readonly onDidEvent = this.eventEmitter.event;

    public constructor(options: {
        runners?: Iterable<AgentRunner>;
        mcpServerProvider?: () => Promise<McpServerReference[]>;
        store?: PersistedAgentSessionStore;
    } = {}) {
        for (const runner of options.runners ?? []) {
            this.registerRunner(runner);
        }
        this.mcpServerProvider = options.mcpServerProvider;
        this.store = options.store;
    }

    public registerRunner(runner: AgentRunner): void {
        const existing = this.runners.get(runner.id);
        if (existing && existing !== runner) {
            throw new Error(`Agent runner '${runner.id}' is already registered.`);
        }
        this.runners.set(runner.id, runner);
    }

    public listRunners(): AgentRunner[] {
        return [...this.runners.values()];
    }

    public async startSession(
        runnerId: AgentRunnerId,
        request: AgentSessionStartRequest
    ): Promise<AgentSession> {
        const runner = this.requireRunner(runnerId);
        const mcpServers = await this.resolveMcpServers(runner, request);
        const session = await runner.startSession({
            ...request,
            ...(mcpServers ? { mcpServers } : {})
        });
        const snapshot = session.getSnapshot();
        this.registerSession(session, snapshot);
        await this.store?.save(snapshot);
        return session;
    }

    public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
        const inMemory = this.sessions.get(reference.sessionId);
        if (inMemory && inMemory.reference.runnerId === reference.runnerId) {
            return inMemory.session;
        }

        const runner = this.requireRunner(reference.runnerId);
        if (!runner.attachSession) {
            return this.createTerminatedAttachedSession(reference);
        }

        try {
            const session = await runner.attachSession(reference);
            const snapshot = session.getSnapshot();
            this.registerSession(session, snapshot);
            await this.store?.save(snapshot);
            return session;
        } catch {
            return this.createTerminatedAttachedSession(reference);
        }
    }

    public listSessions(): AgentSessionSnapshot[] {
        return [...this.sessions.values()].map((entry) => ({ ...entry.snapshot }));
    }

    public async submitPrompt(sessionId: AgentSessionId, prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
        if (!prompt) {
            throw new Error('Prompt payload is required.');
        }
        const record = this.requireSession(sessionId);
        const snapshot = await record.session.submitPrompt(prompt);
        await this.updateSnapshot(sessionId, snapshot);
        return snapshot;
    }

    public async submitCommand(sessionId: AgentSessionId, command: AgentCommand): Promise<AgentSessionSnapshot> {
        const record = this.requireSession(sessionId);
        const snapshot = await record.session.submitCommand(command);
        await this.updateSnapshot(sessionId, snapshot);
        return snapshot;
    }

    public async cancelSession(sessionId: AgentSessionId, reason?: string): Promise<AgentSessionSnapshot> {
        const record = this.requireSession(sessionId);
        const snapshot = await record.session.cancel(reason);
        await this.updateSnapshot(sessionId, snapshot);
        return snapshot;
    }

    public async terminateSession(sessionId: AgentSessionId, reason?: string): Promise<AgentSessionSnapshot> {
        const record = this.requireSession(sessionId);
        const snapshot = await record.session.terminate(reason);
        await this.updateSnapshot(sessionId, snapshot);
        return snapshot;
    }

    private requireRunner(runnerId: AgentRunnerId): AgentRunner {
        const runner = this.runners.get(runnerId);
        if (!runner) {
            throw new Error(`Agent runner '${runnerId}' is not registered.`);
        }
        return runner;
    }

    private requireSession(sessionId: AgentSessionId): OrchestratorSessionRecord {
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Agent session '${sessionId}' is not attached.`);
        }
        return record;
    }

    private registerSession(session: AgentSession, snapshot: AgentSessionSnapshot): void {
        const existing = this.sessions.get(session.sessionId);
        existing?.subscription.dispose();

        const normalizedSnapshot = this.normalizeSnapshot(snapshot, snapshot);
        const subscription = session.onDidEvent((event) => {
            void this.handleSessionEvent(session.sessionId, event);
        });

        this.sessions.set(session.sessionId, {
            reference: {
                runnerId: session.runnerId,
                sessionId: session.sessionId
            },
            session,
            snapshot: { ...normalizedSnapshot },
            subscription
        });
    }

    private async updateSnapshot(sessionId: AgentSessionId, snapshot: AgentSessionSnapshot): Promise<void> {
        const record = this.requireSession(sessionId);
        record.snapshot = this.normalizeSnapshot(snapshot, record.snapshot);
        await this.store?.save(record.snapshot);
    }

    private async handleSessionEvent(sessionId: AgentSessionId, event: AgentSessionEvent): Promise<void> {
        const record = this.requireSession(sessionId);
        const normalized = this.normalizeSnapshot(event.snapshot, record.snapshot);
        record.snapshot = normalized;
        await this.store?.save(normalized);
        this.eventEmitter.fire({
            ...event,
            snapshot: { ...normalized }
        });
    }

    private normalizeSnapshot(
        snapshot: AgentSessionSnapshot,
        fallback: Pick<AgentSessionSnapshot, 'missionId' | 'taskId'>
    ): AgentSessionSnapshot {
        return {
            ...snapshot,
            missionId: snapshot.missionId || fallback.missionId,
            taskId: snapshot.taskId || fallback.taskId
        };
    }

    private async resolveMcpServers(
        runner: AgentRunner,
        request: AgentSessionStartRequest
    ): Promise<McpServerReference[] | undefined> {
        const requested = request.mcpServers;
        const injected = this.mcpServerProvider ? await this.mcpServerProvider() : undefined;
        const merged = [...(requested ?? []), ...(injected ?? [])];
        if (merged.length === 0) {
            return undefined;
        }
        if (!runner.capabilities.mcpClient) {
            throw new Error(`Agent runner '${runner.id}' does not support MCP client attachment.`);
        }
        return merged;
    }

    private createTerminatedAttachedSession(reference: AgentSessionReference): AgentSession {
        const terminatedSnapshot: AgentSessionSnapshot = {
            runnerId: reference.runnerId,
            sessionId: reference.sessionId,
            phase: 'terminated',
            missionId: 'unknown',
            taskId: 'unknown',
            acceptsPrompts: false,
            acceptedCommands: [],
            awaitingInput: false,
            failureMessage: 'Session no longer exists in provider runtime.',
            updatedAt: new Date().toISOString()
        };

        const session: AgentSession = {
            runnerId: reference.runnerId,
            sessionId: reference.sessionId,
            getSnapshot: () => ({ ...terminatedSnapshot }),
            onDidEvent: (listener) => {
                queueMicrotask(() => {
                    listener({
                        type: 'session.terminated',
                        reason: 'Session no longer exists in provider runtime.',
                        snapshot: { ...terminatedSnapshot }
                    });
                });
                return { dispose: () => undefined };
            },
            submitPrompt: async () => ({ ...terminatedSnapshot }),
            submitCommand: async () => ({ ...terminatedSnapshot }),
            cancel: async () => ({ ...terminatedSnapshot }),
            terminate: async () => ({ ...terminatedSnapshot }),
            dispose: () => undefined
        };

        this.registerSession(session, terminatedSnapshot);
        this.eventEmitter.fire({
            type: 'session.terminated',
            reason: 'Session no longer exists in provider runtime.',
            snapshot: { ...terminatedSnapshot }
        });
        void this.store?.save(terminatedSnapshot);
        return session;
    }
}
