import { TerminalRegistry, type TerminalRecordingUpdate, type TerminalSnapshot } from '../../Terminal/TerminalRegistry.js';
import {
    AgentExecutionTerminalRecordingEventSchema,
    type AgentExecutionType,
    type AgentExecutionTerminalRecordingEventType
} from '../AgentExecutionSchema.js';
import type { MissionDossierFilesystem } from '../../Mission/MissionDossierFilesystem.js';

type AgentExecutionTerminalRecordingWriterState = {
    execution: AgentExecutionType;
    events: AgentExecutionTerminalRecordingEventType[];
    bufferBytes: number;
    queue: Promise<void>;
    flushTimer: ReturnType<typeof setTimeout> | undefined;
    wroteExit: boolean;
};

const TERMINAL_RECORDING_FLUSH_THRESHOLD_BYTES = 4096;
const TERMINAL_RECORDING_FLUSH_DELAY_MS = 250;

export class AgentExecutionTerminalRecordingWriter {
    private readonly terminalSubscription: { dispose(): void };
    private readonly terminalRecordingSubscription: { dispose(): void };
    private readonly writers = new Map<string, AgentExecutionTerminalRecordingWriterState>();
    private readonly agentExecutionIdsByTerminalName = new Map<string, string>();
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

    public reconcile(agentExecutions: AgentExecutionType[]): void {
        if (this.disposed) {
            return;
        }

        const activeAgentExecutionIds = new Set<string>();
        this.agentExecutionIdsByTerminalName.clear();
        for (const execution of agentExecutions) {
            activeAgentExecutionIds.add(execution.agentExecutionId);
            if (execution.terminalHandle) {
                this.agentExecutionIdsByTerminalName.set(execution.terminalHandle.terminalName, execution.agentExecutionId);
            }
            const writer = this.ensureWriter(execution);
            if (writer) {
                writer.execution = execution;
            }
        }

        for (const [agentExecutionId, writer] of this.writers) {
            if (activeAgentExecutionIds.has(agentExecutionId)) {
                continue;
            }
            this.flush(writer);
            this.writers.delete(agentExecutionId);
        }
    }

    public update(execution: AgentExecutionType): void {
        if (this.disposed) {
            return;
        }
        if (execution.terminalHandle) {
            this.agentExecutionIdsByTerminalName.set(execution.terminalHandle.terminalName, execution.agentExecutionId);
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
        this.agentExecutionIdsByTerminalName.clear();
    }

    private handleTerminalUpdate(event: TerminalSnapshot & { chunk: string }): void {
        if (this.disposed) {
            return;
        }

        const agentExecutionId = this.agentExecutionIdsByTerminalName.get(event.terminalName);
        if (!agentExecutionId) {
            return;
        }

        const writer = this.writers.get(agentExecutionId);
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
        if (writer.bufferBytes >= TERMINAL_RECORDING_FLUSH_THRESHOLD_BYTES || event.dead) {
            this.flush(writer);
            return;
        }

        this.scheduleFlush(writer);
    }

    private handleTerminalRecordingUpdate(update: TerminalRecordingUpdate): void {
        if (this.disposed) {
            return;
        }
        const agentExecutionId = this.agentExecutionIdsByTerminalName.get(update.terminalName);
        if (!agentExecutionId) {
            return;
        }
        const writer = this.writers.get(agentExecutionId);
        if (!writer) {
            return;
        }
        this.enqueueEvent(writer, update.event);
        this.scheduleFlush(writer);
    }

    private ensureWriter(execution: AgentExecutionType): AgentExecutionTerminalRecordingWriterState | undefined {
        if (!execution.terminalHandle || execution.transportId !== 'terminal') {
            return undefined;
        }

        const existing = this.writers.get(execution.agentExecutionId);
        if (existing) {
            return existing;
        }

        const writer: AgentExecutionTerminalRecordingWriterState = {
            execution,
            events: [],
            bufferBytes: 0,
            queue: Promise.resolve(),
            flushTimer: undefined,
            wroteExit: false
        };
        this.writers.set(execution.agentExecutionId, writer);
        const terminalRecordingPath = this.adapter.getMissionTerminalRecordingRelativePath(execution.agentExecutionId);
        writer.queue = writer.queue
            .then(() => this.adapter.ensureMissionTerminalRecordingFile(this.missionDir, terminalRecordingPath))
            .then(() => this.adapter.appendMissionTerminalRecordingEvent(this.missionDir, terminalRecordingPath, this.createHeaderEvent(execution)))
            .catch((error) => {
                console.error(
                    `Failed to create AgentExecution terminal recording for mission '${this.missionId}' AgentExecution '${execution.agentExecutionId}'.`,
                    error
                );
            });
        return writer;
    }

    private scheduleFlush(writer: AgentExecutionTerminalRecordingWriterState): void {
        if (writer.flushTimer) {
            return;
        }
        writer.flushTimer = setTimeout(() => {
            writer.flushTimer = undefined;
            this.flush(writer);
        }, TERMINAL_RECORDING_FLUSH_DELAY_MS);
    }

    private flush(writer: AgentExecutionTerminalRecordingWriterState): void {
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
        const terminalRecordingPath = this.adapter.getMissionTerminalRecordingRelativePath(execution.agentExecutionId);
        const appendEvents = async () => {
            for (const event of events) {
                await this.adapter.appendMissionTerminalRecordingEvent(this.missionDir, terminalRecordingPath, event);
            }
        };
        const next = writer.queue.then(appendEvents, appendEvents);
        writer.queue = next.catch((error) => {
            console.error(
                `Failed to persist AgentExecution terminal recording for mission '${this.missionId}' AgentExecution '${execution.agentExecutionId}'.`,
                error
            );
        });
    }

    private enqueueEvent(
        writer: AgentExecutionTerminalRecordingWriterState,
        event: AgentExecutionTerminalRecordingEventType
    ): void {
        const parsedEvent = AgentExecutionTerminalRecordingEventSchema.parse(event);
        writer.events.push(parsedEvent);
        writer.bufferBytes += Buffer.byteLength(JSON.stringify(parsedEvent), 'utf8') + 1;
    }

    private createHeaderEvent(execution: AgentExecutionType): AgentExecutionTerminalRecordingEventType {
        const terminalSnapshot = execution.terminalHandle
            ? this.terminalRegistry.readSnapshot(execution.terminalHandle.terminalName)
            : undefined;
        return AgentExecutionTerminalRecordingEventSchema.parse({
            type: 'header',
            version: 1,
            kind: 'agent-execution-terminal-recording',
            ownerId: this.missionId,
            agentExecutionId: execution.agentExecutionId,
            terminalName: execution.terminalHandle?.terminalName ?? execution.agentExecutionId,
            cols: terminalSnapshot?.cols ?? 120,
            rows: terminalSnapshot?.rows ?? 32,
            createdAt: execution.createdAt
        });
    }
}