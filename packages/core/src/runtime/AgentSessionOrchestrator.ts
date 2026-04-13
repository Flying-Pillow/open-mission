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
            transportId: request.transportId ?? runner.transportId,
            ...(mcpServers ? { mcpServers } : {})
        });
        const snapshot = session.getSnapshot();
        this.registerSession(session, snapshot);
        await this.store?.save(snapshot);
        return session;
    }

    public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
        const inMemory = this.sessions.get(reference.sessionId);
        if (
            inMemory
            && inMemory.reference.runnerId === reference.runnerId
            && inMemory.reference.transportId === reference.transportId
        ) {
            return inMemory.session;
        }

        let runner: AgentRunner;
        try {
            runner = this.requireRunner(reference.runnerId);
        } catch {
            return this.createTerminatedAttachedSession(reference);
        }
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

    public dispose(): void {
        for (const sessionId of [...this.sessions.keys()]) {
            this.releaseSession(sessionId);
        }
        this.eventEmitter.dispose();
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
        const record = this.sessions.get(sessionId);
        if (!record) {
            return this.handleUnattachedTerminalSession(sessionId, 'cancel', reason);
        }
        try {
            const snapshot = await record.session.cancel(reason);
            await this.updateSnapshot(sessionId, snapshot);
            return snapshot;
        } catch (error) {
            if (!isDetachedSessionError(error)) {
                throw error;
            }
            return this.terminateDetachedSession(record, 'cancel', reason);
        }
    }

    public async terminateSession(sessionId: AgentSessionId, reason?: string): Promise<AgentSessionSnapshot> {
        const record = this.sessions.get(sessionId);
        if (!record) {
            return this.handleUnattachedTerminalSession(sessionId, 'terminate', reason);
        }
        try {
            const snapshot = await record.session.terminate(reason);
            await this.updateSnapshot(sessionId, snapshot);
            return snapshot;
        } catch (error) {
            if (!isDetachedSessionError(error)) {
                throw error;
            }
            return this.terminateDetachedSession(record, 'terminate', reason);
        }
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
        existing?.session.dispose();

        const normalizedSnapshot = this.normalizeSnapshot(snapshot, snapshot);
        const subscription = session.onDidEvent((event) => {
            void this.handleSessionEvent(session.sessionId, event);
        });

        this.sessions.set(session.sessionId, {
            reference: {
                runnerId: session.runnerId,
                ...(session.transportId ? { transportId: session.transportId } : {}),
                sessionId: session.sessionId,
                ...(normalizedSnapshot.terminalSessionName ? { terminalSessionName: normalizedSnapshot.terminalSessionName } : {}),
                ...(normalizedSnapshot.terminalPaneId ? { terminalPaneId: normalizedSnapshot.terminalPaneId } : {})
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
        const record = this.sessions.get(sessionId);
        if (!record) {
            return;
        }
        const normalized = this.normalizeSnapshot(event.snapshot, record.snapshot);
        record.snapshot = normalized;
        await this.store?.save(normalized);
        this.eventEmitter.fire({
            ...event,
            snapshot: { ...normalized }
        });
        if (isTerminalPhase(normalized.phase)) {
            await this.store?.delete(record.reference);
            this.releaseSession(sessionId);
        }
    }

    private releaseSession(sessionId: AgentSessionId): void {
        const record = this.sessions.get(sessionId);
        if (!record) {
            return;
        }

        record.subscription.dispose();
        record.session.dispose();
        this.sessions.delete(sessionId);
    }

    private async terminateDetachedSession(
        record: OrchestratorSessionRecord,
        action: 'cancel' | 'terminate',
        reason?: string
    ): Promise<AgentSessionSnapshot> {
        const snapshot: AgentSessionSnapshot = {
            ...record.snapshot,
            phase: action === 'cancel' ? 'cancelled' : 'terminated',
            acceptsPrompts: false,
            awaitingInput: false,
            updatedAt: new Date().toISOString(),
            ...(reason ? { failureMessage: reason } : {})
        };

        record.snapshot = snapshot;
        await this.store?.save(snapshot);
        this.eventEmitter.fire({
            type: action === 'cancel' ? 'session.cancelled' : 'session.terminated',
            ...(reason ? { reason } : {}),
            snapshot: { ...snapshot }
        });
        await this.store?.delete(record.reference);
        this.releaseSession(record.reference.sessionId);
        return { ...snapshot };
    }

    private async handleUnattachedTerminalSession(
        sessionId: AgentSessionId,
        action: 'cancel' | 'terminate',
        reason?: string
    ): Promise<AgentSessionSnapshot> {
        const persisted = await this.store?.list();
        const reference = persisted?.find((candidate) => candidate.sessionId === sessionId);
        const persistedSnapshot = reference
            ? await this.store?.load(reference)
            : undefined;
        const snapshot: AgentSessionSnapshot = {
            runnerId: persistedSnapshot?.runnerId ?? reference?.runnerId ?? 'unknown',
            ...(persistedSnapshot?.transportId
                ? { transportId: persistedSnapshot.transportId }
                : reference?.transportId
                    ? { transportId: reference.transportId }
                    : {}),
            sessionId,
            ...(persistedSnapshot?.terminalSessionName
                ? { terminalSessionName: persistedSnapshot.terminalSessionName }
                : reference?.terminalSessionName
                    ? { terminalSessionName: reference.terminalSessionName }
                    : {}),
            ...(persistedSnapshot?.terminalPaneId
                ? { terminalPaneId: persistedSnapshot.terminalPaneId }
                : reference?.terminalPaneId
                    ? { terminalPaneId: reference.terminalPaneId }
                    : {}),
            phase: action === 'cancel' ? 'cancelled' : 'terminated',
            missionId: persistedSnapshot?.missionId ?? 'unknown',
            taskId: persistedSnapshot?.taskId ?? 'unknown',
            acceptsPrompts: false,
            acceptedCommands: [],
            awaitingInput: false,
            updatedAt: new Date().toISOString(),
            ...(reason ? { failureMessage: reason } : {})
        };

        this.eventEmitter.fire({
            type: action === 'cancel' ? 'session.cancelled' : 'session.terminated',
            ...(reason ? { reason } : {}),
            snapshot: { ...snapshot }
        });

        if (reference) {
            await this.store?.delete(reference);
        }

        return { ...snapshot };
    }

    private normalizeSnapshot(
        snapshot: AgentSessionSnapshot,
        fallback: Pick<AgentSessionSnapshot, 'missionId' | 'taskId' | 'terminalSessionName' | 'terminalPaneId'>
    ): AgentSessionSnapshot {
        return {
            ...snapshot,
            missionId: snapshot.missionId || fallback.missionId,
            taskId: snapshot.taskId || fallback.taskId,
            ...(snapshot.terminalSessionName || fallback.terminalSessionName
                ? { terminalSessionName: snapshot.terminalSessionName || fallback.terminalSessionName }
                : {}),
            ...(snapshot.terminalPaneId || fallback.terminalPaneId
                ? { terminalPaneId: snapshot.terminalPaneId || fallback.terminalPaneId }
                : {})
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

    private async createTerminatedAttachedSession(reference: AgentSessionReference): Promise<AgentSession> {
        const persistedSnapshot = await this.store?.load(reference);
        const terminatedSnapshot: AgentSessionSnapshot = {
            runnerId: persistedSnapshot?.runnerId ?? reference.runnerId,
            ...(persistedSnapshot?.transportId
                ? { transportId: persistedSnapshot.transportId }
                : reference.transportId
                    ? { transportId: reference.transportId }
                    : {}),
            sessionId: reference.sessionId,
            ...(persistedSnapshot?.terminalSessionName
                ? { terminalSessionName: persistedSnapshot.terminalSessionName }
                : reference.terminalSessionName
                    ? { terminalSessionName: reference.terminalSessionName }
                    : {}),
            ...(persistedSnapshot?.terminalPaneId
                ? { terminalPaneId: persistedSnapshot.terminalPaneId }
                : reference.terminalPaneId
                    ? { terminalPaneId: reference.terminalPaneId }
                    : {}),
            phase: 'terminated',
            missionId: persistedSnapshot?.missionId ?? 'unknown',
            taskId: persistedSnapshot?.taskId ?? 'unknown',
            acceptsPrompts: false,
            acceptedCommands: [],
            awaitingInput: false,
            failureMessage: 'Session no longer exists in provider runtime.',
            updatedAt: new Date().toISOString()
        };

        const session: AgentSession = {
            runnerId: reference.runnerId,
            transportId: reference.transportId,
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
        void this.store?.save(terminatedSnapshot).then(() => this.store?.delete(reference));
        this.releaseSession(reference.sessionId);
        return session;
    }
}

function isTerminalPhase(phase: AgentSessionSnapshot['phase']): boolean {
    return phase === 'completed'
        || phase === 'failed'
        || phase === 'cancelled'
        || phase === 'terminated';
}

function isDetachedSessionError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('is not attached');
}
