// /apps/airport/web/src/lib/components/entities/AgentExecution/AgentExecution.svelte.ts: OO browser entity for a mission agent execution hydrated from validated runtime snapshots.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { AgentExecutionCommandIds, type AgentExecutionCommandType, type AgentExecutionPromptType, type AgentExecutionDataType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type AgentExecutionDependencies = {
    resolveCommands(sessionId: string): EntityCommandDescriptorType[];
    executeCommand(sessionId: string, commandId: string, input?: unknown): Promise<void>;
};

export class AgentExecution implements EntityModel<AgentExecutionDataType> {
    private dataState = $state<AgentExecutionDataType | undefined>();
    private readonly dependencies: AgentExecutionDependencies;

    public constructor(data: AgentExecutionDataType, dependencies: AgentExecutionDependencies) {
        this.data = data;
        this.dependencies = dependencies;
    }

    private get data(): AgentExecutionDataType {
        const data = this.dataState;
        if (!data) {
            throw new Error('Agent execution snapshot is not initialized.');
        }

        return data;
    }

    private set data(data: AgentExecutionDataType) {
        this.dataState = structuredClone(data);
    }

    public get sessionId(): string {
        return this.data.sessionId;
    }

    public get id(): string {
        return this.sessionId;
    }

    public get entityName(): 'AgentExecution' {
        return 'AgentExecution';
    }

    public get entityId(): string {
        return this.sessionId;
    }

    public get taskId(): string | undefined {
        return this.data.taskId;
    }

    public get lifecycleState(): AgentExecutionDataType['lifecycleState'] {
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

    public get terminalName(): string | undefined {
        return this.data.terminalHandle?.terminalName;
    }

    public get terminalHandle(): AgentExecutionDataType['terminalHandle'] {
        return this.data.terminalHandle;
    }

    public get interactionCapabilities(): AgentExecutionDataType['interactionCapabilities'] {
        return this.data.interactionCapabilities;
    }

    public get interactionMode(): AgentExecutionDataType['interactionCapabilities']['mode'] {
        return this.interactionCapabilities.mode;
    }

    public get interactionReason(): string | undefined {
        return this.interactionCapabilities.reason;
    }

    public get runtimeMessages(): AgentExecutionDataType['runtimeMessages'] {
        return this.data.runtimeMessages;
    }

    public get canSendTerminalInput(): boolean {
        return this.interactionCapabilities.canSendTerminalInput;
    }

    public get canSendStructuredPrompt(): boolean {
        return this.interactionCapabilities.canSendStructuredPrompt;
    }

    public get canSendStructuredCommand(): boolean {
        return this.interactionCapabilities.canSendStructuredCommand;
    }

    public isRunning(): boolean {
        return this.lifecycleState === 'starting'
            || this.lifecycleState === 'running'
            || this.lifecycleState === 'awaiting-input';
    }

    public isTerminalBacked(): boolean {
        return this.transportId === 'terminal'
            && Boolean(this.terminalHandle?.terminalName);
    }

    public hasPersistedTerminalLog(): boolean {
        return typeof this.sessionLogPath === 'string' && this.sessionLogPath.trim().length > 0;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.sessionId);
    }

    public async sendPrompt(prompt: AgentExecutionPromptType): Promise<this> {
        await this.executeCommand(AgentExecutionCommandIds.sendPrompt, prompt);
        return this;
    }

    public async executeCommand(commandId: string, input?: unknown): Promise<void> {
        await this.dependencies.executeCommand(this.sessionId, commandId, input);
    }

    public async sendCommand(command: AgentExecutionCommandType): Promise<this> {
        await this.executeCommand(AgentExecutionCommandIds.sendRuntimeMessage, command);
        return this;
    }

    public async done(): Promise<this> {
        await this.executeCommand(AgentExecutionCommandIds.complete);
        return this;
    }

    public async cancel(reason?: string): Promise<this> {
        await this.executeCommand(AgentExecutionCommandIds.cancel, reason?.trim() ? { reason: reason.trim() } : undefined);
        return this;
    }

    public updateFromData(data: AgentExecutionDataType): this {
        this.data = data;
        return this;
    }

    public update(data: AgentExecutionDataType): this {
        return this.updateFromData(data);
    }

    public toData(): AgentExecutionDataType {
        return structuredClone($state.snapshot(this.data));
    }

    public toJSON(): AgentExecutionDataType {
        return this.toData();
    }
}
