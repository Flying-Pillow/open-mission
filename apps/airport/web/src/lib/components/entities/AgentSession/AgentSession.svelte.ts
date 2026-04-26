// /apps/airport/web/src/lib/components/entities/AgentSession/AgentSession.svelte.ts: OO browser entity for a mission agent session hydrated from validated runtime snapshots.
import type {
    MissionAgentCommand as AgentCommand,
    MissionAgentPrompt as AgentPrompt,
    MissionAgentSessionSnapshot as AgentSessionSnapshot
} from '@flying-pillow/mission-core/schemas';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type AgentSessionCommandOwner = {
    completeSession(sessionId: string): Promise<void>;
    cancelSession(sessionId: string, reason?: string): Promise<void>;
    terminateSession(sessionId: string, reason?: string): Promise<void>;
    sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<void>;
    sendSessionCommand(sessionId: string, command: AgentCommand): Promise<void>;
};

export class AgentSession implements EntityModel<AgentSessionSnapshot> {
    private dataState = $state<AgentSessionSnapshot | undefined>();
    private readonly owner: AgentSessionCommandOwner;

    public constructor(data: AgentSessionSnapshot, owner: AgentSessionCommandOwner) {
        this.data = data;
        this.owner = owner;
    }

    private get data(): AgentSessionSnapshot {
        const data = this.dataState;
        if (!data) {
            throw new Error('Agent session snapshot is not initialized.');
        }

        return data;
    }

    private set data(data: AgentSessionSnapshot) {
        this.dataState = structuredClone(data);
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
        this.data = data;
        return this;
    }

    public update(data: AgentSessionSnapshot): this {
        return this.updateFromSnapshot(data);
    }

    public toSnapshot(): AgentSessionSnapshot {
        return structuredClone($state.snapshot(this.data));
    }

    public toJSON(): AgentSessionSnapshot {
        return this.toSnapshot();
    }
}
