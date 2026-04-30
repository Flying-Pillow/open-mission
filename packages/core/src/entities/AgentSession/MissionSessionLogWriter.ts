import { TerminalAgentTransport, type TerminalSessionSnapshot } from '../../daemon/runtime/agent/TerminalAgentTransport.js';
import type { AgentSessionRecord } from '../../daemon/protocol/contracts.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';

type SessionLogWriterState = {
    session: AgentSessionRecord;
    buffer: string;
    bufferBytes: number;
    queue: Promise<void>;
    flushTimer: ReturnType<typeof setTimeout> | undefined;
};

const SESSION_LOG_FLUSH_THRESHOLD_BYTES = 4096;
const SESSION_LOG_FLUSH_DELAY_MS = 250;

export class MissionSessionLogWriter {
    private readonly terminalSubscription: { dispose(): void };
    private readonly writers = new Map<string, SessionLogWriterState>();
    private readonly sessionIdsByTerminalName = new Map<string, string>();
    private disposed = false;

    public constructor(
        private readonly adapter: FilesystemAdapter,
        private readonly missionDir: string,
        private readonly missionId: string
    ) {
        this.terminalSubscription = TerminalAgentTransport.onDidSessionUpdate((event) => {
            this.handleTerminalUpdate(event);
        });
    }

    public reconcile(sessions: AgentSessionRecord[]): void {
        if (this.disposed) {
            return;
        }

        const activeSessionIds = new Set<string>();
        this.sessionIdsByTerminalName.clear();
        for (const session of sessions) {
            activeSessionIds.add(session.sessionId);
            if (session.terminalSessionName) {
                this.sessionIdsByTerminalName.set(session.terminalSessionName, session.sessionId);
            }
            const writer = this.ensureWriter(session);
            if (writer) {
                writer.session = session;
            }
        }

        for (const [sessionId, writer] of this.writers) {
            if (activeSessionIds.has(sessionId)) {
                continue;
            }
            this.flush(writer);
            this.writers.delete(sessionId);
        }
    }

    public update(session: AgentSessionRecord): void {
        if (this.disposed) {
            return;
        }
        if (session.terminalSessionName) {
            this.sessionIdsByTerminalName.set(session.terminalSessionName, session.sessionId);
        }
        const writer = this.ensureWriter(session);
        if (writer) {
            writer.session = session;
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.terminalSubscription.dispose();
        for (const writer of this.writers.values()) {
            this.flush(writer);
        }
        this.writers.clear();
        this.sessionIdsByTerminalName.clear();
    }

    private handleTerminalUpdate(event: TerminalSessionSnapshot & { chunk: string }): void {
        if (this.disposed || event.chunk.length === 0) {
            return;
        }

        const sessionId = this.sessionIdsByTerminalName.get(event.sessionName);
        if (!sessionId) {
            return;
        }

        const writer = this.writers.get(sessionId);
        if (!writer) {
            return;
        }

        writer.buffer += event.chunk;
        writer.bufferBytes += Buffer.byteLength(event.chunk, 'utf8');
        if (writer.bufferBytes >= SESSION_LOG_FLUSH_THRESHOLD_BYTES || event.dead) {
            this.flush(writer);
            return;
        }

        this.scheduleFlush(writer);
    }

    private ensureWriter(session: AgentSessionRecord): SessionLogWriterState | undefined {
        if (!session.terminalSessionName || session.transportId !== 'terminal') {
            return undefined;
        }

        const existing = this.writers.get(session.sessionId);
        if (existing) {
            return existing;
        }

        const writer: SessionLogWriterState = {
            session,
            buffer: '',
            bufferBytes: 0,
            queue: Promise.resolve(),
            flushTimer: undefined
        };
        this.writers.set(session.sessionId, writer);
        const sessionLogPath = session.sessionLogPath ?? this.adapter.getMissionSessionLogRelativePath(session.sessionId);
        writer.queue = writer.queue
            .then(() => this.adapter.ensureMissionSessionLogFile(this.missionDir, sessionLogPath))
            .catch((error) => {
                console.error(
                    `Failed to create session log for mission '${this.missionId}' session '${session.sessionId}'.`,
                    error
                );
            });
        return writer;
    }

    private scheduleFlush(writer: SessionLogWriterState): void {
        if (writer.flushTimer) {
            return;
        }
        writer.flushTimer = setTimeout(() => {
            writer.flushTimer = undefined;
            this.flush(writer);
        }, SESSION_LOG_FLUSH_DELAY_MS);
    }

    private flush(writer: SessionLogWriterState): void {
        if (writer.flushTimer) {
            clearTimeout(writer.flushTimer);
            writer.flushTimer = undefined;
        }
        if (writer.buffer.length === 0) {
            return;
        }

        const chunk = writer.buffer;
        writer.buffer = '';
        writer.bufferBytes = 0;
        const session = writer.session;
        const sessionLogPath = session.sessionLogPath ?? this.adapter.getMissionSessionLogRelativePath(session.sessionId);
        const next = writer.queue.then(
            () => this.adapter.appendMissionSessionLogChunk(this.missionDir, sessionLogPath, chunk),
            () => this.adapter.appendMissionSessionLogChunk(this.missionDir, sessionLogPath, chunk)
        );
        writer.queue = next.catch((error) => {
            console.error(
                `Failed to persist session log for mission '${this.missionId}' session '${session.sessionId}'.`,
                error
            );
        });
    }
}