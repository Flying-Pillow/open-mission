// /apps/airport/web/src/lib/components/entities/AgentExecution/AgentExecution.svelte.ts: OO browser entity for a mission agent execution hydrated from validated runtime snapshots.
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { AgentExecutionCommandIds, AgentExecutionCommandSchema, AgentExecutionMessageShorthandResolutionSchema, type AgentExecutionCommandPortabilityType, type AgentExecutionCommandType, type AgentExecutionPromptType, type AgentExecutionDataType, type AgentExecutionMessageDescriptorType, type AgentExecutionMessageShorthandResolutionType, type AgentExecutionSemanticOperationPayloadType, type AgentExecutionSemanticOperationResultType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { AgentExecutionJournalRecordType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionJournalSchema';
import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';

export type AgentExecutionDependencies = {
    resolveCommands(agentExecutionId: string): EntityCommandDescriptorType[];
    executeCommand(ownerId: string, agentExecutionId: string, commandId: string, input?: unknown): Promise<void>;
    resolveMessageShorthand(ownerId: string, agentExecutionId: string, text: string, terminalLane?: boolean): Promise<AgentExecutionMessageShorthandResolutionType>;
    invokeSemanticOperation(ownerId: string, agentExecutionId: string, operation: AgentExecutionSemanticOperationPayloadType): Promise<AgentExecutionSemanticOperationResultType>;
};

export class AgentExecution extends Entity<AgentExecutionDataType> {
    private dataState = $state<AgentExecutionDataType | undefined>();
    private readonly dependencies: AgentExecutionDependencies;

    public constructor(data: AgentExecutionDataType, dependencies: AgentExecutionDependencies) {
        super();
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

    public get agentExecutionId(): string {
        return this.data.agentExecutionId;
    }

    public get ownerId(): string {
        return this.data.ownerId;
    }

    public get id(): string {
        return this.agentExecutionId;
    }

    public get entityName(): 'AgentExecution' {
        return 'AgentExecution';
    }

    public get entityId(): string {
        return this.agentExecutionId;
    }

    protected get entityLocator(): Record<string, unknown> {
        return {
            ownerId: this.ownerId,
            agentExecutionId: this.agentExecutionId
        };
    }

    public get taskId(): string | undefined {
        return this.data.taskId;
    }

    public get assignmentLabel(): string | undefined {
        return this.data.assignmentLabel;
    }

    public get scope(): AgentExecutionDataType["scope"] {
        return this.data.scope;
    }

    public get lifecycleState(): AgentExecutionDataType['lifecycleState'] {
        return this.data.lifecycleState;
    }

    public get terminalRecordingPath(): string | undefined {
        return this.data.terminalRecordingPath;
    }

    public get agentId(): string {
        return this.data.agentId;
    }

    public get adapterLabel(): string {
        return this.data.adapterLabel;
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

    public get protocolMessages(): AgentExecutionMessageDescriptorType[] {
        return this.data.protocolDescriptor?.messages ?? this.runtimeMessages;
    }

    public get missionNativeMessages(): AgentExecutionMessageDescriptorType[] {
        return this.protocolMessages.filter((message) => message.portability === 'mission-native');
    }

    public static commandPortabilityLabel(portability: AgentExecutionCommandPortabilityType): string {
        switch (portability) {
            case 'mission-native':
                return 'Mission-native';
            case 'cross-agent':
                return 'Cross-agent';
            case 'adapter-scoped':
                return 'Adapter-scoped';
            case 'terminal-only':
                return 'Terminal-only';
        }
    }

    public createRuntimeMessageCommand(input: {
        descriptor: AgentExecutionMessageDescriptorType;
        reason?: string;
    }): AgentExecutionCommandType {
        const reason = input.reason?.trim();
        if (input.descriptor.portability === 'terminal-only') {
            throw new Error(`AgentExecution command '${input.descriptor.type}' is terminal-only and must be sent from the terminal pane.`);
        }
        if (input.descriptor.portability === 'mission-native') {
            throw new Error(`AgentExecution command '${input.descriptor.type}' is Mission-native and must be routed through its owning Mission command.`);
        }
        if (input.descriptor.portability === 'adapter-scoped' && !input.descriptor.adapterId) {
            throw new Error(`Adapter-scoped AgentExecution command '${input.descriptor.type}' is missing an adapter id.`);
        }

        return AgentExecutionCommandSchema.parse(input.descriptor.portability === 'adapter-scoped'
            ? {
                type: input.descriptor.type,
                portability: 'adapter-scoped',
                adapterId: input.descriptor.adapterId,
                ...(reason ? { reason } : {})
            }
            : {
                type: input.descriptor.type,
                ...(reason ? { reason } : {})
            });
    }

    public get projection(): AgentExecutionDataType['projection'] {
        return this.data.projection;
    }

    public get currentActivity(): AgentExecutionDataType['projection']['currentActivity'] {
        return this.data.projection.currentActivity;
    }

    public get transportState(): AgentExecutionDataType['transportState'] {
        return this.data.transportState;
    }

    public get currentAttention(): AgentExecutionDataType['projection']['currentAttention'] {
        return this.data.projection.currentAttention;
    }

    public get timelineItems(): AgentExecutionDataType['projection']['timelineItems'] {
        return this.data.projection.timelineItems;
    }

    public get journalRecords(): AgentExecutionJournalRecordType[] {
        return (this.data.journalRecords ?? []) as AgentExecutionJournalRecordType[];
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
            || this.lifecycleState === 'running';
    }

    public isTerminalBacked(): boolean {
        return this.transportId === 'terminal'
            && Boolean(this.terminalHandle?.terminalName);
    }

    public hasPersistedTerminalLog(): boolean {
        return typeof this.terminalRecordingPath === 'string' && this.terminalRecordingPath.trim().length > 0;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return this.dependencies.resolveCommands(this.agentExecutionId);
    }

    public async sendPrompt(prompt: AgentExecutionPromptType): Promise<this> {
        await this.executeCommand(AgentExecutionCommandIds.sendPrompt, prompt);
        return this;
    }

    public async sendMessageText(text: string): Promise<this> {
        const resolution = await this.resolveMessageShorthand(text);
        switch (resolution.kind) {
            case 'prompt':
                await this.sendPrompt(resolution.input);
                return this;
            case 'runtime-message':
                await this.sendCommand(resolution.input);
                return this;
            case 'semantic-operation':
                await this.invokeSemanticOperation(resolution.input);
                return this;
            case 'terminal-input':
                throw new Error('Terminal-only Agent commands must be sent from the terminal pane.');
            case 'parse-error':
                throw new Error(resolution.summary);
        }
    }

    public async resolveMessageShorthand(text: string, options: { terminalLane?: boolean } = {}): Promise<AgentExecutionMessageShorthandResolutionType> {
        return AgentExecutionMessageShorthandResolutionSchema.parse(await this.dependencies.resolveMessageShorthand(
            this.ownerId,
            this.agentExecutionId,
            text,
            options.terminalLane
        ));
    }

    public async invokeSemanticOperation(operation: AgentExecutionSemanticOperationPayloadType): Promise<AgentExecutionSemanticOperationResultType> {
        return this.dependencies.invokeSemanticOperation(this.ownerId, this.agentExecutionId, operation);
    }

    public async executeCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
        await this.dependencies.executeCommand(this.ownerId, this.agentExecutionId, commandId, input);
        return undefined as TResult;
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
