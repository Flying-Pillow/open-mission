import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentExecutionObservation,
    AgentLaunchConfig
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import {
    AgentExecutionCommandSchema,
    AgentExecutionDataSchema,
    AgentExecutionObservationAckSchema,
    AgentExecutionPromptSchema,
    type AgentExecutionObservationAckType,
    type AgentExecutionDataType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecutor } from './AgentExecutor.js';
import type { MissionMcpServer } from './mcp/MissionMcpServer.js';
import type {
    AgentExecutionSemanticOperationInvocationType,
    AgentExecutionSemanticOperationInvoker,
    AgentExecutionSemanticOperationResultType
} from './AgentExecutionSemanticOperations.js';

type AgentExecutionRegistryEntry = {
    ownerKey: string;
    agentExecutor: AgentExecutor;
    execution: AgentExecution;
    dataChangeSubscription: { dispose(): void };
};

export type AgentExecutionRegistryCommand =
    | { commandId: 'agentExecution.complete' }
    | { commandId: 'agentExecution.cancel'; input?: unknown }
    | { commandId: 'agentExecution.sendPrompt'; input?: unknown }
    | { commandId: 'agentExecution.sendRuntimeMessage'; input?: unknown };

type AgentExecutionRegistryOptions = {
    missionMcpServer?: MissionMcpServer;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export class AgentExecutionRegistry implements AgentExecutionSemanticOperationInvoker {
    private readonly executionsByAgentExecutionId = new Map<string, AgentExecutionRegistryEntry>();
    private readonly agentExecutionIdsByOwnerKey = new Map<string, string>();
    private readonly dataChangeListeners = new Set<(data: AgentExecutionDataType) => void>();
    private missionMcpServer: MissionMcpServer | undefined;
    private logger: AgentExecutionRegistryOptions['logger'];

    public constructor(options: AgentExecutionRegistryOptions = {}) {
        this.logger = options.logger;
        this.missionMcpServer = options.missionMcpServer;
    }

    public configure(options: AgentExecutionRegistryOptions = {}): void {
        if (options.logger) {
            this.logger = options.logger;
        }
        if (options.missionMcpServer) {
            this.missionMcpServer = options.missionMcpServer;
        }
    }

    public async ensureExecution(input: {
        ownerKey: string;
        agentRegistry: AgentRegistry;
        config: AgentLaunchConfig;
    }): Promise<AgentExecutionDataType> {
        const requestedAgentId = input.agentRegistry.resolveStartAgentId(input.config.requestedAdapterId);
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (existingAgentExecutionId) {
            const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
            if (existing) {
                const snapshot = existing.execution.getSnapshot();
                if (!AgentExecution.isTerminalFinalStatus(snapshot.status)) {
                    if (this.isReusableExecution(existing.execution, requestedAgentId)) {
                        return this.toExecutionData(existing.execution);
                    }
                    await this.retireExecution(
                        existingAgentExecutionId,
                        snapshot.agentId === requestedAgentId
                            ? 'replaced after runtime transport degradation'
                            : `replaced by ${requestedAgentId ?? 'requested'} Agent adapter`
                    );
                } else {
                    this.disposeAgentExecution(existingAgentExecutionId);
                }
            }
        }

        return this.startExecution(input);
    }

    public readReusableExecution(input: {
        ownerKey: string;
        requestedAgentId?: string;
    }): AgentExecutionDataType | undefined {
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (!existingAgentExecutionId) {
            return undefined;
        }

        const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
        if (!existing) {
            this.agentExecutionIdsByOwnerKey.delete(input.ownerKey);
            return undefined;
        }

        const snapshot = existing.execution.getSnapshot();
        if (AgentExecution.isTerminalFinalStatus(snapshot.status)) {
            this.disposeAgentExecution(existingAgentExecutionId);
            return undefined;
        }

        if (!this.isReusableExecution(existing.execution, input.requestedAgentId)) {
            return undefined;
        }

        return this.toExecutionData(existing.execution);
    }

    public async replaceActiveExecution(input: {
        ownerKey: string;
        agentRegistry: AgentRegistry;
        config: AgentLaunchConfig;
    }): Promise<AgentExecutionDataType | undefined> {
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (!existingAgentExecutionId) {
            return undefined;
        }
        const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
        if (!existing) {
            this.agentExecutionIdsByOwnerKey.delete(input.ownerKey);
            return undefined;
        }
        const snapshot = existing.execution.getSnapshot();
        if (AgentExecution.isTerminalFinalStatus(snapshot.status)) {
            this.disposeAgentExecution(existingAgentExecutionId);
            return undefined;
        }

        const requestedAgentId = input.agentRegistry.resolveStartAgentId(input.config.requestedAdapterId);
        await this.retireExecution(
            existingAgentExecutionId,
            snapshot.agentId === requestedAgentId
                ? 'restarted by explicit repository refresh'
                : `replaced by ${requestedAgentId ?? 'requested'} Agent adapter`
        );
        return this.startExecution(input);
    }

    private async startExecution(input: {
        ownerKey: string;
        agentRegistry: AgentRegistry;
        config: AgentLaunchConfig;
    }): Promise<AgentExecutionDataType> {
        const agentExecutor = new AgentExecutor({
            agentRegistry: input.agentRegistry,
            ...(this.missionMcpServer ? { missionMcpServer: this.missionMcpServer } : {}),
            ...(this.logger ? { logger: this.logger } : {})
        });
        const execution = await agentExecutor.startExecution(input.config);
        const agentExecutionId = execution.agentExecutionId;
        this.disposeAgentExecution(agentExecutionId);
        const dataChangeSubscription = execution.onDidDataChange((data) => this.emitDataChanged(data));
        this.agentExecutionIdsByOwnerKey.set(input.ownerKey, agentExecutionId);
        this.executionsByAgentExecutionId.set(agentExecutionId, {
            ownerKey: input.ownerKey,
            agentExecutor,
            execution,
            dataChangeSubscription
        });
        this.emitDataChanged(this.toExecutionData(execution));
        return this.toExecutionData(execution);
    }

    public readExecution(agentExecutionId: string): AgentExecutionDataType {
        const entry = this.requireExecution(agentExecutionId);
        return this.toExecutionData(entry.execution);
    }

    public async commandExecution(agentExecutionId: string, command: AgentExecutionRegistryCommand): Promise<AgentExecutionDataType> {
        const entry = this.requireExecution(agentExecutionId);
        switch (command.commandId) {
            case 'agentExecution.complete':
                await entry.agentExecutor.completeExecution(agentExecutionId);
                break;
            case 'agentExecution.cancel':
                await entry.agentExecutor.cancelExecution(agentExecutionId, readReason(command.input));
                break;
            case 'agentExecution.sendPrompt':
                await entry.agentExecutor.submitPrompt(agentExecutionId, AgentExecutionPromptSchema.parse(command.input));
                break;
            case 'agentExecution.sendRuntimeMessage':
                await entry.agentExecutor.submitCommand(agentExecutionId, AgentExecutionCommandSchema.parse(command.input));
                break;
        }
        return this.toExecutionData(entry.execution);
    }

    public hasExecution(agentExecutionId: string): boolean {
        return this.executionsByAgentExecutionId.has(agentExecutionId);
    }

    public readRuntimeSummary(): { activeAgentExecutionCount: number } {
        let activeAgentExecutionCount = 0;
        for (const entry of this.executionsByAgentExecutionId.values()) {
            if (!AgentExecution.isTerminalFinalStatus(entry.execution.getSnapshot().status)) {
                activeAgentExecutionCount += 1;
            }
        }
        return { activeAgentExecutionCount };
    }

    public async routeTransportObservation(input: {
        agentExecutionId: string;
        observation: AgentExecutionObservation;
    }): Promise<AgentExecutionObservationAckType> {
        const entry = this.executionsByAgentExecutionId.get(input.agentExecutionId);
        if (!entry) {
            return AgentExecutionObservationAckSchema.parse({
                status: 'rejected',
                agentExecutionId: input.agentExecutionId,
                eventId: readObservationEventId(input.observation),
                observationId: input.observation.observationId,
                reason: `AgentExecution '${input.agentExecutionId}' is not registered in the daemon AgentExecutionRegistry.`
            });
        }
        return AgentExecutionObservationAckSchema.parse(await entry.agentExecutor.routeTransportObservation(input));
    }

    public async invokeSemanticOperation(input: AgentExecutionSemanticOperationInvocationType): Promise<AgentExecutionSemanticOperationResultType> {
        const entry = this.executionsByAgentExecutionId.get(input.agentExecutionId);
        if (!entry) {
            throw new Error(`AgentExecution '${input.agentExecutionId}' is not registered in the daemon AgentExecutionRegistry.`);
        }
        return entry.agentExecutor.invokeSemanticOperation(input);
    }

    public onDidExecutionDataChange(listener: (data: AgentExecutionDataType) => void): { dispose(): void } {
        this.dataChangeListeners.add(listener);
        return {
            dispose: () => {
                this.dataChangeListeners.delete(listener);
            }
        };
    }

    public dispose(): void {
        for (const agentExecutionId of [...this.executionsByAgentExecutionId.keys()]) {
            this.disposeAgentExecution(agentExecutionId);
        }
        this.agentExecutionIdsByOwnerKey.clear();
    }

    private requireExecution(agentExecutionId: string): AgentExecutionRegistryEntry {
        const entry = this.executionsByAgentExecutionId.get(agentExecutionId);
        if (!entry) {
            throw new Error(`AgentExecution '${agentExecutionId}' is not registered in the daemon AgentExecutionRegistry.`);
        }
        return entry;
    }

    private isReusableExecution(execution: AgentExecution, requestedAgentId?: string): boolean {
        const data = this.toExecutionData(execution);
        if (requestedAgentId && data.agentId !== requestedAgentId) {
            return false;
        }
        return isReusableTransportState(data.transportState);
    }

    private async retireExecution(agentExecutionId: string, reason: string): Promise<void> {
        const entry = this.executionsByAgentExecutionId.get(agentExecutionId);
        if (!entry) {
            return;
        }

        try {
            await entry.agentExecutor.terminateExecution(agentExecutionId, reason);
        } catch (error) {
            this.logger?.debug('Failed to terminate AgentExecution before retirement.', {
                agentExecutionId,
                reason,
                error: error instanceof Error ? error.message : String(error)
            });
        } finally {
            this.disposeAgentExecution(agentExecutionId);
        }
    }

    private disposeAgentExecution(agentExecutionId: string): void {
        const entry = this.executionsByAgentExecutionId.get(agentExecutionId);
        if (!entry) {
            return;
        }
        entry.agentExecutor.dispose();
        entry.dataChangeSubscription.dispose();
        this.executionsByAgentExecutionId.delete(agentExecutionId);
        if (this.agentExecutionIdsByOwnerKey.get(entry.ownerKey) === agentExecutionId) {
            this.agentExecutionIdsByOwnerKey.delete(entry.ownerKey);
        }
    }

    private toExecutionData(execution: AgentExecution): AgentExecutionDataType {
        return AgentExecutionDataSchema.parse(execution.toData());
    }

    private emitDataChanged(data: AgentExecutionDataType): void {
        const parsed = AgentExecutionDataSchema.parse(data);
        for (const listener of this.dataChangeListeners) {
            listener(parsed);
        }
    }
}

let defaultAgentExecutionRegistry: AgentExecutionRegistry | undefined;

export function getDefaultAgentExecutionRegistry(options: AgentExecutionRegistryOptions = {}): AgentExecutionRegistry {
    defaultAgentExecutionRegistry ??= new AgentExecutionRegistry(options);
    defaultAgentExecutionRegistry.configure(options);
    return defaultAgentExecutionRegistry;
}

export function setDefaultAgentExecutionRegistry(registry: AgentExecutionRegistry): void {
    defaultAgentExecutionRegistry = registry;
}

function readReason(input: unknown): string | undefined {
    if (!isRecord(input) || typeof input['reason'] !== 'string') {
        return undefined;
    }
    const reason = input['reason'].trim();
    return reason.length > 0 ? reason : undefined;
}

function isReusableTransportState(transportState: AgentExecutionDataType['transportState']): boolean {
    if (!transportState) {
        return true;
    }

    if (transportState.degraded) {
        return false;
    }

    if (transportState.health && transportState.health !== 'attached') {
        return false;
    }

    if (
        transportState.terminalAttached === false
        || transportState.leaseAttached === false
        || transportState.ownerMatched === false
        || transportState.commandable === false
        || transportState.signalCompatible === false
    ) {
        return false;
    }

    return true;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readObservationEventId(observation: AgentExecutionObservation): string {
    const prefix = 'agent-signal:';
    if (observation.observationId.startsWith(prefix)) {
        const eventId = observation.observationId.slice(prefix.length).trim();
        if (eventId) {
            return eventId;
        }
    }
    return observation.observationId;
}
