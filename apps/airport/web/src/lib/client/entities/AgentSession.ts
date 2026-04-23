// /apps/airport/web/src/lib/client/entities/AgentSession.ts: OO browser entity for a mission agent session hydrated from validated runtime snapshots.
import type {
    AgentCommand as AgentCommand,
    AgentPrompt as AgentPrompt,
    AgentSession as AgentSessionSnapshot
} from '@flying-pillow/mission-core/airport/runtime';
import type { EntityModel } from '$lib/client/entities/EntityModel';

export type AgentSessionCommandOwner = {
    completeSession(sessionId: string): Promise<void>;
    cancelSession(sessionId: string, reason?: string): Promise<void>;
    terminateSession(sessionId: string, reason?: string): Promise<void>;
    sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<void>;
    sendSessionCommand(sessionId: string, command: AgentCommand): Promise<void>;
};

export class AgentSession implements EntityModel<AgentSessionSnapshot> {
    private data: AgentSessionSnapshot;
    private readonly owner: AgentSessionCommandOwner;

    public constructor(data: AgentSessionSnapshot, owner: AgentSessionCommandOwner) {
        this.data = structuredClone(data);
        this.owner = owner;
    }

    public get sessionId(): string {
        return this.data.sessionId;
    }

    public get id(): string {
        return this.sessionId;
    }

    public get taskId(): string | undefined {
        return this.data.taskId;
    }

    public get lifecycleState(): AgentSessionSnapshot['lifecycleState'] {
        return this.data.lifecycleState;
    }

    public get sessionLogPath(): string | undefined {
        return this.data.sessionLogPath;
    }

    public get transportId(): string | undefined {
        return this.data.transportId;
    }

    public get currentTurnTitle(): string | undefined {
        return this.data.currentTurnTitle;
    }

    public get workingDirectory(): string | undefined {
        return this.data.workingDirectory;
    }

    public get terminalSessionName(): string | undefined {
        return this.data.terminalSessionName;
    }

    public get terminalPaneId(): string | undefined {
        return this.data.terminalPaneId;
    }

    public get terminalHandle(): AgentSessionSnapshot['terminalHandle'] {
        return this.data.terminalHandle;
    }

    public isRunning(): boolean {
        return this.lifecycleState === 'starting'
            || this.lifecycleState === 'running'
            || this.lifecycleState === 'awaiting-input';
    }

    public isTerminalBacked(): boolean {
        return this.transportId === 'terminal'
            && Boolean(this.terminalHandle?.sessionName || this.terminalSessionName);
    }

    public hasPersistedTerminalLog(): boolean {
        return typeof this.sessionLogPath === 'string' && this.sessionLogPath.trim().length > 0;
    }

    public async sendPrompt(prompt: AgentPrompt): Promise<this> {
        await this.owner.sendSessionPrompt(this.sessionId, prompt);
        return this;
    }

    public async sendCommand(command: AgentCommand): Promise<this> {
        await this.owner.sendSessionCommand(this.sessionId, command);
        return this;
    }

    public async done(): Promise<this> {
        await this.owner.completeSession(this.sessionId);
        return this;
    }

    public async cancel(reason?: string): Promise<this> {
        await this.owner.cancelSession(this.sessionId, reason);
        return this;
    }

    public async terminate(reason?: string): Promise<this> {
        await this.owner.terminateSession(this.sessionId, reason);
        return this;
    }

    public updateFromSnapshot(data: AgentSessionSnapshot): this {
        this.data = structuredClone(data);
        return this;
    }

    public update(data: AgentSessionSnapshot): this {
        return this.updateFromSnapshot(data);
    }

    public toSnapshot(): AgentSessionSnapshotSnapshot {
        return structuredClone(this.data);
    }

    public toJSON(): AgentSessionSnapshotSnapshot {
        return this.toSnapshot();
    }
}
