// /apps/airport/web/src/lib/components/entities/AgentSession/AgentSession.svelte.ts: OO browser entity for a mission agent session hydrated from validated runtime snapshots.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { AgentSessionCommandType, AgentSessionPromptType, AgentSessionDataType } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type AgentSessionDependencies = {
    executeCommand(sessionId: string, commandId: string, input?: unknown): Promise<void>;
    sendPrompt(sessionId: string, prompt: AgentSessionPromptType): Promise<void>;
    sendCommand(sessionId: string, command: AgentSessionCommandType): Promise<void>;
};

export class AgentSession implements EntityModel<AgentSessionDataType> {
    private dataState = $state<AgentSessionDataType | undefined>();
    private readonly dependencies: AgentSessionDependencies;

    public constructor(data: AgentSessionDataType, dependencies: AgentSessionDependencies) {
        this.data = data;
        this.dependencies = dependencies;
    }

    private get data(): AgentSessionDataType {
        const data = this.dataState;
        if (!data) {
            throw new Error('Agent session snapshot is not initialized.');
        }

        return data;
    }

    private set data(data: AgentSessionDataType) {
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

    public get lifecycleState(): AgentSessionDataType['lifecycleState'] {
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

    public get terminalHandle(): AgentSessionDataType['terminalHandle'] {
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

    public async sendPrompt(prompt: AgentSessionPromptType): Promise<this> {
        await this.dependencies.sendPrompt(this.sessionId, prompt);
        return this;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.dependencies.executeCommand(this.sessionId, commandId, input);
    }

    public async sendCommand(command: AgentSessionCommandType): Promise<this> {
        await this.dependencies.sendCommand(this.sessionId, command);
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

    public updateFromData(data: AgentSessionDataType): this {
        this.data = data;
        return this;
    }

    public update(data: AgentSessionDataType): this {
        return this.updateFromData(data);
    }

    public toData(): AgentSessionDataType {
        return structuredClone($state.snapshot(this.data));
    }

    public toJSON(): AgentSessionDataType {
        return this.toData();
    }
}
