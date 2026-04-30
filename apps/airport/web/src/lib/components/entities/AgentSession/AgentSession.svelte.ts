// /apps/airport/web/src/lib/components/entities/AgentSession/AgentSession.svelte.ts: OO browser entity for a mission agent session hydrated from validated runtime snapshots.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { MissionAgentCommand as AgentCommand, MissionAgentPrompt as AgentPrompt, MissionAgentSessionSnapshot as AgentSessionSnapshot } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type AgentSessionCommandOwner = {
    executeSessionCommand(sessionId: string, commandId: string, input?: unknown): Promise<void>;
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

    public get entityName(): 'AgentSession' {
        return 'AgentSession';
    }

    public get entityId(): string {
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

    public get commands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.data.commands ?? []));
    }

    public async sendPrompt(prompt: AgentPrompt): Promise<this> {
        await this.owner.sendSessionPrompt(this.sessionId, prompt);
        return this;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.owner.executeSessionCommand(this.sessionId, commandId, input);
    }

    public async sendCommand(command: AgentCommand): Promise<this> {
        await this.owner.sendSessionCommand(this.sessionId, command);
        return this;
    }

    public async done(): Promise<this> {
        await this.executeCommand('agentSession.complete');
        return this;
    }

    public async cancel(reason?: string): Promise<this> {
        await this.executeCommand('agentSession.cancel', reason?.trim() ? { reason: reason.trim() } : undefined);
        return this;
    }

    public async terminate(reason?: string): Promise<this> {
        await this.executeCommand('agentSession.terminate', reason?.trim() ? { reason: reason.trim() } : undefined);
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
