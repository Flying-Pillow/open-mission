import { TerminalRegistry, type TerminalRecordingUpdate, type TerminalSnapshot } from '../../../entities/Terminal/TerminalRegistry.js';
import {
    AgentExecutionTerminalRecordingEventSchema,
    type AgentExecutionRecord,
    type AgentExecutionTerminalRecordingEventType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import type { MissionDossierFilesystem } from '../../../entities/Mission/MissionDossierFilesystem.js';

type AgentExecutionLogWriterState = {
    execution: AgentExecutionRecord;
    events: AgentExecutionTerminalRecordingEventType[];
    bufferBytes: number;
    queue: Promise<void>;
    flushTimer: ReturnType<typeof setTimeout> | undefined;
    wroteExit: boolean;
};

const SESSION_LOG_FLUSH_THRESHOLD_BYTES = 4096;
const SESSION_LOG_FLUSH_DELAY_MS = 250;

export class AgentExecutionLogWriter {
    private readonly terminalSubscription: { dispose(): void };
    private readonly terminalRecordingSubscription: { dispose(): void };
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
        this.terminalRecordingSubscription = this.terminalRegistry.onDidTerminalRecordingUpdate((event) => {
            this.handleTerminalRecordingUpdate(event);
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
        this.terminalRecordingSubscription.dispose();
        for (const writer of this.writers.values()) {
            this.flush(writer);
        }
        this.writers.clear();
        this.sessionIdsByTerminalName.clear();
    }

    private handleTerminalUpdate(event: TerminalSnapshot & { chunk: string }): void {
        if (this.disposed) {
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

        if (event.chunk.length > 0) {
            this.enqueueEvent(writer, {
                type: 'output',
                at: new Date().toISOString(),
                data: event.chunk
            });
        }
        if (event.dead && !writer.wroteExit) {
            writer.wroteExit = true;
            this.enqueueEvent(writer, {
                type: 'exit',
                at: new Date().toISOString(),
                exitCode: event.exitCode
            });
        }
        if (writer.bufferBytes >= SESSION_LOG_FLUSH_THRESHOLD_BYTES || event.dead) {
            this.flush(writer);
            return;
        }

        this.scheduleFlush(writer);
    }

    private handleTerminalRecordingUpdate(update: TerminalRecordingUpdate): void {
        if (this.disposed) {
            return;
        }
        const sessionId = this.sessionIdsByTerminalName.get(update.terminalName);
        if (!sessionId) {
            return;
        }
        const writer = this.writers.get(sessionId);
        if (!writer) {
            return;
        }
        this.enqueueEvent(writer, update.event);
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
            events: [],
            bufferBytes: 0,
            queue: Promise.resolve(),
            flushTimer: undefined,
            wroteExit: false
        };
        this.writers.set(execution.sessionId, writer);
        const sessionLogPath = this.adapter.getMissionSessionLogRelativePath(execution.sessionId);
        writer.queue = writer.queue
            .then(() => this.adapter.ensureMissionSessionLogFile(this.missionDir, sessionLogPath))
            .then(() => this.adapter.appendMissionSessionLogEvent(this.missionDir, sessionLogPath, this.createHeaderEvent(execution)))
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
        if (writer.events.length === 0) {
            return;
        }

        const events = writer.events;
        writer.events = [];
        writer.bufferBytes = 0;
        const execution = writer.execution;
        const sessionLogPath = this.adapter.getMissionSessionLogRelativePath(execution.sessionId);
        const appendEvents = async () => {
            for (const event of events) {
                await this.adapter.appendMissionSessionLogEvent(this.missionDir, sessionLogPath, event);
            }
        };
        const next = writer.queue.then(appendEvents, appendEvents);
        writer.queue = next.catch((error) => {
            console.error(
                `Failed to persist session log for mission '${this.missionId}' session '${execution.sessionId}'.`,
                error
            );
        });
    }

    private enqueueEvent(
        writer: AgentExecutionLogWriterState,
        event: AgentExecutionTerminalRecordingEventType
    ): void {
        const parsedEvent = AgentExecutionTerminalRecordingEventSchema.parse(event);
        writer.events.push(parsedEvent);
        writer.bufferBytes += Buffer.byteLength(JSON.stringify(parsedEvent), 'utf8') + 1;
    }

    private createHeaderEvent(execution: AgentExecutionRecord): AgentExecutionTerminalRecordingEventType {
        const terminalSnapshot = execution.terminalHandle
            ? this.terminalRegistry.readSnapshot(execution.terminalHandle.terminalName)
            : undefined;
        return AgentExecutionTerminalRecordingEventSchema.parse({
            type: 'header',
            version: 1,
            kind: 'agent-execution-terminal-recording',
            ownerId: this.missionId,
            sessionId: execution.sessionId,
            terminalName: execution.terminalHandle?.terminalName ?? execution.sessionId,
            cols: terminalSnapshot?.cols ?? 120,
            rows: terminalSnapshot?.rows ?? 32,
            createdAt: execution.createdAt
        });
    }
}