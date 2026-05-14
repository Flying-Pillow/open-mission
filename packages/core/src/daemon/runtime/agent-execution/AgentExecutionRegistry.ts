import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentExecutionObservation,
    AgentLaunchConfig
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import {
    AgentExecutionCommandSchema,
    AgentExecutionSchema,
    AgentExecutionObservationAckSchema,
    AgentExecutionPromptSchema,
    type AgentExecutionObservationAckType,
    type AgentExecutionType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecutionCoordinator } from './AgentExecutionCoordinator.js';
import type { OpenMissionMcpServer } from './mcp/OpenMissionMcpServer.js';
import type {
    AgentExecutionSemanticOperationInvocationType,
    AgentExecutionSemanticOperationInvoker,
    AgentExecutionSemanticOperationResultType
} from './AgentExecutionSemanticOperations.js';

type AgentExecutionRegistryEntry = {
    ownerKey: string;
    agentExecutionCoordinator: AgentExecutionCoordinator;
    execution: AgentExecution;
    dataChangeSubscription: { dispose(): void };
};

export type AgentExecutionRuntimeSummaryEntry = {
    ownerId: string;
    agentId: string;
    agentExecutionId: string;
    scope: AgentExecutionType['scope'];
    status: AgentExecutionType['lifecycleState'];
    transportState?: AgentExecutionType['transportState'];
    terminalName?: string;
    hasRuntimeLease: boolean;
    attached: boolean;
    degraded: boolean;
    protocolIncompatible: boolean;
};

export type AgentExecutionRuntimeSummary = {
    activeAgentExecutionCount: number;
    attachedAgentExecutionCount: number;
    detachedAgentExecutionCount: number;
    degradedAgentExecutionCount: number;
    protocolIncompatibleAgentExecutionCount: number;
    executionsWithoutRuntimeLeaseCount: number;
    executions: AgentExecutionRuntimeSummaryEntry[];
};

export type AgentExecutionRegistryCommand =
    | { commandId: 'agentExecution.complete' }
    | { commandId: 'agentExecution.cancel'; input?: unknown }
    | { commandId: 'agentExecution.sendPrompt'; input?: unknown }
    | { commandId: 'agentExecution.sendRuntimeMessage'; input?: unknown };

type AgentExecutionRegistryOptions = {
    openMissionMcpServer?: OpenMissionMcpServer;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export class AgentExecutionRegistry implements AgentExecutionSemanticOperationInvoker {
    private readonly executionsByAgentExecutionId = new Map<string, AgentExecutionRegistryEntry>();
    private readonly agentExecutionIdsByOwnerKey = new Map<string, string>();
    private readonly dataChangeListeners = new Set<(data: AgentExecutionType) => void>();
    private openMissionMcpServer: OpenMissionMcpServer | undefined;
    private logger: AgentExecutionRegistryOptions['logger'];

    public constructor(options: AgentExecutionRegistryOptions = {}) {
        this.logger = options.logger;
        this.openMissionMcpServer = options.openMissionMcpServer;
    }

    public configure(options: AgentExecutionRegistryOptions = {}): void {
        if (options.logger) {
            this.logger = options.logger;
        }
        if (options.openMissionMcpServer) {
            this.openMissionMcpServer = options.openMissionMcpServer;
        }
    }

    public async ensureExecution(input: {
        ownerKey: string;
        agentRegistry: AgentRegistry;
        config: AgentLaunchConfig;
    }): Promise<AgentExecutionType> {
        const requestedAgentId = input.agentRegistry.resolveStartAgentId(input.config.requestedAdapterId);
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (existingAgentExecutionId) {
            const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
            if (existing) {
                const snapshot = existing.execution.getExecution();
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
    }): AgentExecutionType | undefined {
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (!existingAgentExecutionId) {
            return undefined;
        }

        const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
        if (!existing) {
            this.agentExecutionIdsByOwnerKey.delete(input.ownerKey);
            return undefined;
        }

        const snapshot = existing.execution.getExecution();
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
    }): Promise<AgentExecutionType | undefined> {
        const existingAgentExecutionId = this.agentExecutionIdsByOwnerKey.get(input.ownerKey);
        if (!existingAgentExecutionId) {
            return undefined;
        }
        const existing = this.executionsByAgentExecutionId.get(existingAgentExecutionId);
        if (!existing) {
            this.agentExecutionIdsByOwnerKey.delete(input.ownerKey);
            return undefined;
        }
        const snapshot = existing.execution.getExecution();
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
    }): Promise<AgentExecutionType> {
        const agentExecutionCoordinator = new AgentExecutionCoordinator({
            agentRegistry: input.agentRegistry,
            ...(this.openMissionMcpServer ? { openMissionMcpServer: this.openMissionMcpServer } : {}),
            ...(this.logger ? { logger: this.logger } : {})
        });
        const execution = await agentExecutionCoordinator.startExecution(input.config);
        const agentExecutionId = execution.agentExecutionId;
        this.disposeAgentExecution(agentExecutionId);
        const dataChangeSubscription = execution.onDidDataChange((data) => this.emitDataChanged(data));
        this.agentExecutionIdsByOwnerKey.set(input.ownerKey, agentExecutionId);
        this.executionsByAgentExecutionId.set(agentExecutionId, {
            ownerKey: input.ownerKey,
            agentExecutionCoordinator,
            execution,
            dataChangeSubscription
        });
        this.emitDataChanged(this.toExecutionData(execution));
        return this.toExecutionData(execution);
    }

    public readExecution(agentExecutionId: string): AgentExecutionType {
        const entry = this.requireExecution(agentExecutionId);
        return this.toExecutionData(entry.execution);
    }

    public async commandExecution(agentExecutionId: string, command: AgentExecutionRegistryCommand): Promise<AgentExecutionType> {
        const entry = this.requireExecution(agentExecutionId);
        switch (command.commandId) {
            case 'agentExecution.complete':
                await entry.agentExecutionCoordinator.completeExecution(agentExecutionId);
                break;
            case 'agentExecution.cancel':
                await entry.agentExecutionCoordinator.cancelExecution(agentExecutionId, readReason(command.input));
                break;
            case 'agentExecution.sendPrompt':
                await entry.agentExecutionCoordinator.submitPrompt(agentExecutionId, AgentExecutionPromptSchema.parse(command.input));
                break;
            case 'agentExecution.sendRuntimeMessage':
                await entry.agentExecutionCoordinator.submitCommand(agentExecutionId, AgentExecutionCommandSchema.parse(command.input));
                break;
        }
        return this.toExecutionData(entry.execution);
    }

    public hasExecution(agentExecutionId: string): boolean {
        return this.executionsByAgentExecutionId.has(agentExecutionId);
    }

    public readRuntimeSummary(): AgentExecutionRuntimeSummary {
        const executions: AgentExecutionRuntimeSummaryEntry[] = [];
        for (const entry of this.executionsByAgentExecutionId.values()) {
            const snapshot = entry.execution.getExecution();
            if (AgentExecution.isTerminalFinalStatus(snapshot.status)) {
                continue;
            }
            const data = this.toExecutionData(entry.execution);
            const terminalName = snapshot.transport?.kind === 'terminal' ? snapshot.transport.terminalName : undefined;
            const hasRuntimeLease = Boolean(terminalName) && data.transportState?.leaseAttached !== false;
            const health = data.transportState?.health;
            const protocolIncompatible = health === 'protocol-incompatible';
            const degraded = Boolean(data.transportState?.degraded) || protocolIncompatible || health === 'degraded';
            const detached = health === 'detached' || health === 'orphaned' || !hasRuntimeLease;
            executions.push({
                ownerId: data.ownerId,
                agentId: data.agentId,
                agentExecutionId: data.agentExecutionId,
                scope: data.scope,
                status: data.lifecycleState,
                ...(data.transportState ? { transportState: data.transportState } : {}),
                ...(terminalName ? { terminalName } : {}),
                hasRuntimeLease,
                attached: !detached && !degraded,
                degraded: degraded || detached,
                protocolIncompatible
            });
        }
        return {
            activeAgentExecutionCount: executions.length,
            attachedAgentExecutionCount: executions.filter((entry) => entry.attached).length,
            detachedAgentExecutionCount: executions.filter((entry) => !entry.hasRuntimeLease).length,
            degradedAgentExecutionCount: executions.filter((entry) => entry.degraded).length,
            protocolIncompatibleAgentExecutionCount: executions.filter((entry) => entry.protocolIncompatible).length,
            executionsWithoutRuntimeLeaseCount: executions.filter((entry) => !entry.hasRuntimeLease).length,
            executions
        };
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
        return AgentExecutionObservationAckSchema.parse(await entry.agentExecutionCoordinator.routeTransportObservation(input));
    }

    public async invokeSemanticOperation(input: AgentExecutionSemanticOperationInvocationType): Promise<AgentExecutionSemanticOperationResultType> {
        const entry = this.executionsByAgentExecutionId.get(input.agentExecutionId);
        if (!entry) {
            throw new Error(`AgentExecution '${input.agentExecutionId}' is not registered in the daemon AgentExecutionRegistry.`);
        }
        return entry.agentExecutionCoordinator.invokeSemanticOperation(input);
    }

    public onDidExecutionDataChange(listener: (data: AgentExecutionType) => void): { dispose(): void } {
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
            await entry.agentExecutionCoordinator.terminateExecution(agentExecutionId, reason);
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
        entry.agentExecutionCoordinator.dispose();
        entry.dataChangeSubscription.dispose();
        this.executionsByAgentExecutionId.delete(agentExecutionId);
        if (this.agentExecutionIdsByOwnerKey.get(entry.ownerKey) === agentExecutionId) {
            this.agentExecutionIdsByOwnerKey.delete(entry.ownerKey);
        }
    }

    private toExecutionData(execution: AgentExecution): AgentExecutionType {
        return AgentExecutionSchema.parse(execution.toData());
    }

    private emitDataChanged(data: AgentExecutionType): void {
        const parsed = AgentExecutionSchema.parse(data);
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

function isReusableTransportState(transportState: AgentExecutionType['transportState']): boolean {
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
