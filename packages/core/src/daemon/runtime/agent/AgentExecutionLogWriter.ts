import { TerminalRegistry, type TerminalSnapshot } from '../../../entities/Terminal/TerminalRegistry.js';
import type { AgentExecutionRecord } from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import type { MissionDossierFilesystem } from '../../../entities/Mission/MissionDossierFilesystem.js';

type AgentExecutionLogWriterState = {
    execution: AgentExecutionRecord;
    buffer: string;
    bufferBytes: number;
    queue: Promise<void>;
    flushTimer: ReturnType<typeof setTimeout> | undefined;
};

const SESSION_LOG_FLUSH_THRESHOLD_BYTES = 4096;
const SESSION_LOG_FLUSH_DELAY_MS = 250;

export class AgentExecutionLogWriter {
    private readonly terminalSubscription: { dispose(): void };
    private readonly writers = new Map<string, AgentExecutionLogWriterState>();
    private readonly sessionIdsByTerminalName = new Map<string, string>();
    private readonly terminalRegistry = TerminalRegistry.shared();
    private disposed = false;

    public constructor(
        private readonly adapter: MissionDossierFilesystem,
        private readonly missionDir: string,
        private readonly missionId: string
    ) {
        this.terminalSubscription = this.terminalRegistry.onDidTerminalUpdate((event) => {
            this.handleTerminalUpdate(event);
        });
    }

    public reconcile(sessions: AgentExecutionRecord[]): void {
        if (this.disposed) {
            return;
        }

        const activeSessionIds = new Set<string>();
        this.sessionIdsByTerminalName.clear();
        for (const execution of sessions) {
            activeSessionIds.add(execution.sessionId);
            if (execution.terminalHandle) {
                this.sessionIdsByTerminalName.set(execution.terminalHandle.terminalName, execution.sessionId);
            }
            const writer = this.ensureWriter(execution);
            if (writer) {
                writer.execution = execution;
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

    public update(execution: AgentExecutionRecord): void {
        if (this.disposed) {
            return;
        }
        if (execution.terminalHandle) {
            this.sessionIdsByTerminalName.set(execution.terminalHandle.terminalName, execution.sessionId);
        }
        const writer = this.ensureWriter(execution);
        if (writer) {
            writer.execution = execution;
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

    private handleTerminalUpdate(event: TerminalSnapshot & { chunk: string }): void {
        if (this.disposed || event.chunk.length === 0) {
            return;
        }

        const sessionId = this.sessionIdsByTerminalName.get(event.terminalName);
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

    private ensureWriter(execution: AgentExecutionRecord): AgentExecutionLogWriterState | undefined {
        if (!execution.terminalHandle || execution.transportId !== 'terminal') {
            return undefined;
        }

        const existing = this.writers.get(execution.sessionId);
        if (existing) {
            return existing;
        }

        const writer: AgentExecutionLogWriterState = {
            execution,
            buffer: '',
            bufferBytes: 0,
            queue: Promise.resolve(),
            flushTimer: undefined
        };
        this.writers.set(execution.sessionId, writer);
        const sessionLogPath = execution.sessionLogPath ?? this.adapter.getMissionSessionLogRelativePath(execution.sessionId);
        writer.queue = writer.queue
            .then(() => this.adapter.ensureMissionSessionLogFile(this.missionDir, sessionLogPath))
            .catch((error) => {
                console.error(
                    `Failed to create session log for mission '${this.missionId}' session '${execution.sessionId}'.`,
                    error
                );
            });
        return writer;
    }

    private scheduleFlush(writer: AgentExecutionLogWriterState): void {
        if (writer.flushTimer) {
            return;
        }
        writer.flushTimer = setTimeout(() => {
            writer.flushTimer = undefined;
            this.flush(writer);
        }, SESSION_LOG_FLUSH_DELAY_MS);
    }

    private flush(writer: AgentExecutionLogWriterState): void {
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
        const execution = writer.execution;
        const sessionLogPath = execution.sessionLogPath ?? this.adapter.getMissionSessionLogRelativePath(execution.sessionId);
        const next = writer.queue.then(
            () => this.adapter.appendMissionSessionLogChunk(this.missionDir, sessionLogPath, chunk),
            () => this.adapter.appendMissionSessionLogChunk(this.missionDir, sessionLogPath, chunk)
        );
        writer.queue = next.catch((error) => {
            console.error(
                `Failed to persist session log for mission '${this.missionId}' session '${execution.sessionId}'.`,
                error
            );
        });
    }
}