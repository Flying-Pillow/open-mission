import { createAgentExecutionProtocolDescriptor } from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolDescriptor.js';
import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    createDefaultAgentExecutionJournalWriter,
    type AgentExecutionJournalWriter
} from '../../../entities/AgentExecution/journal/AgentExecutionJournalWriter.js';
import type { AgentExecutionJournalRecordType } from '../../../entities/AgentExecution/journal/AgentExecutionJournalSchema.js';
import {
    AgentExecutionObservationLedger,
    AgentExecutionObservationPolicy
} from '../../../entities/AgentExecution/runtime/AgentExecutionObservationPolicy.js';
import type {
    AgentCommand,
    AgentExecutionEvent,
    AgentExecutionObservation,
    AgentExecutionReference,
    AgentExecutionScope,
    AgentExecutionType,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionObservationAckType,
    AgentExecutionMessageDescriptorType,
    AgentExecutionProtocolDescriptorType,
    AgentSignalDeliveryType
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolSchema.js';
import type { AgentExecutionTransportStateType } from '../../../entities/AgentExecution/state/AgentExecutionStateSchema.js';
import type { AgentAdapter, AgentExecutionMcpAccess } from './AgentAdapter.js';
import {
    AgentExecutionObservationCoordinator
} from './AgentExecutionObservationCoordinator.js';
import { AgentExecutionProcessController } from './AgentExecutionProcessController.js';
import {
    AgentExecutionSemanticOperations,
    type AgentExecutionSemanticOperationInvocationType,
    type AgentExecutionSemanticOperationResultType
} from './AgentExecutionSemanticOperations.js';
import { AgentExecutionTerminalController } from './AgentExecutionTerminalController.js';
import type {
    AgentExecutionProcessDriver
} from './AgentExecutionProcessDriver.js';
import { ArtifactService } from './ArtifactService.js';
import type { OpenMissionMcpServer } from './mcp/OpenMissionMcpServer.js';
import { buildAgentExecutionSignalLaunchContext } from './signals/AgentExecutionSignalLaunchContext.js';
import { AgentExecutionObservationRouter } from './signals/AgentExecutionObservationRouter.js';

export { AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS } from './AgentExecutionObservationCoordinator.js';

export type AgentExecutorOptions = {
    agentRegistry: AgentRegistry;
    openMissionMcpServer?: OpenMissionMcpServer;
    journalWriter?: AgentExecutionJournalWriter;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

type ManagedAgentExecution = {
    execution: AgentExecution;
    processDriver: AgentExecutionProcessDriver;
    adapter: AgentAdapter;
    eventSubscription: { dispose(): void };
    retainedProcessOutput: string;
    retainProcessOutput: boolean;
    journalScope: AgentExecutionScope;
    parseAgentSignals: boolean;
    observationLedger: AgentExecutionObservationLedger;
    observationPolicy: AgentExecutionObservationPolicy;
    observationQueue: Promise<void>;
    idleObservationTimer: NodeJS.Timeout | undefined;
    cleanup?: () => Promise<void>;
};

type DelegatedRuntimeAgentAdapter = AgentAdapter & {
    startExecution(config: AgentLaunchConfig): Promise<AgentExecution>;
    reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecution>;
};

export class AgentExecutor {
    private readonly agentRegistry: AgentRegistry;
    private readonly journalWriter: AgentExecutionJournalWriter;
    private readonly openMissionMcpServer: OpenMissionMcpServer | undefined;
    private readonly observationCoordinator: AgentExecutionObservationCoordinator;
    private readonly semanticOperations: AgentExecutionSemanticOperations;
    private readonly managedExecutions = new Map<string, ManagedAgentExecution>();

    public constructor(options: AgentExecutorOptions) {
        this.agentRegistry = options.agentRegistry;
        this.journalWriter = options.journalWriter ?? createDefaultAgentExecutionJournalWriter();
        this.openMissionMcpServer = options.openMissionMcpServer;
        const observationRouter = new AgentExecutionObservationRouter({
            ...(options.logger ? { logger: options.logger } : {})
        });
        this.observationCoordinator = new AgentExecutionObservationCoordinator({
            journalWriter: this.journalWriter,
            observationRouter
        });
        this.semanticOperations = new AgentExecutionSemanticOperations({
            artifactService: new ArtifactService(),
            journalWriter: this.journalWriter
        });
    }

    public dispose(): void {
        for (const executionId of [...this.managedExecutions.keys()]) {
            this.disposeManagedExecution(executionId);
        }
    }

    public async startExecution(config: AgentLaunchConfig): Promise<AgentExecution> {
        const agentId = this.agentRegistry.resolveStartAgentId(config.requestedAdapterId);
        if (!agentId) {
            throw new Error('No Agent is available for execution.');
        }
        const agent = this.agentRegistry.requireAgent(agentId);
        const adapter = agent.requireAdapter();
        const availability = await adapter.isAvailable();
        if (!availability.available) {
            throw new Error(availability.reason ?? `Agent '${agentId}' is unavailable.`);
        }
        if (AgentExecutor.isDelegatedRuntimeAdapter(adapter)) {
            return this.startDelegatedExecution(adapter, config);
        }

        const executionId = AgentExecution.createFreshExecutionId(config, adapter.id);
        const preliminaryLaunchPlan = adapter.createLaunchPlan(config);
        const selectedDelivery = this.selectSignalDelivery(adapter, preliminaryLaunchPlan.mode);
        const prepared = await this.prepareLaunch(config, executionId, selectedDelivery, preliminaryLaunchPlan.mode, adapter.getSupportedMessages());
        const mcpAccess = selectedDelivery === 'mcp-tool'
            ? this.registerMcpAccess(prepared.executionId, prepared.protocolDescriptor)
            : undefined;
        const adapterPrepared = await adapter.prepareLaunchConfig(prepared.config, mcpAccess);
        await this.journalWriter.ensureLaunchJournal({
            agentExecutionId: prepared.executionId,
            agentId: adapter.id,
            scope: adapterPrepared.config.scope,
            protocolDescriptor: prepared.protocolDescriptor,
            ...(prepared.transportState ? { transportState: prepared.transportState } : {}),
            ...(adapterPrepared.config.workingDirectory ? { workingDirectory: adapterPrepared.config.workingDirectory } : {})
        });
        const launchPlan = adapter.createLaunchPlan(adapterPrepared.config);
        const processDriver = launchPlan.mode === 'print'
            ? AgentExecutionProcessController.start({
                agentId: adapter.id,
                displayName: adapter.displayName,
                config: adapterPrepared.config,
                launch: {
                    agentExecutionId: prepared.executionId,
                    protocolDescriptor: prepared.protocolDescriptor,
                    transportState: prepared.transportState,
                    command: launchPlan.command,
                    args: launchPlan.args,
                    ...(launchPlan.stdin ? { stdin: launchPlan.stdin } : {}),
                    ...(launchPlan.env ? { env: launchPlan.env } : {})
                }
            })
            : AgentExecutionTerminalController.start({
                ...adapter.terminalOptions,
                agentId: adapter.id,
                displayName: adapter.displayName,
                config: adapterPrepared.config,
                launch: {
                    agentExecutionId: prepared.executionId,
                    protocolDescriptor: prepared.protocolDescriptor,
                    transportState: prepared.transportState,
                    command: launchPlan.command,
                    args: launchPlan.args,
                    skipInitialPromptSubmission: true,
                    ...(launchPlan.env ? { env: launchPlan.env } : {})
                }
            });
        const cleanup = combineCleanup(adapterPrepared.cleanup, mcpAccess ? async () => {
            this.openMissionMcpServer?.unregisterAccess(prepared.executionId);
        } : undefined);
        this.trackExecution({
            processDriver,
            adapter,
            journalScope: adapterPrepared.config.scope,
            parseAgentSignals: selectedDelivery === 'stdout-marker',
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(prepared.executionId, adapterPrepared.config.scope),
            ...(cleanup ? { cleanup } : {})
        });
        processDriver.execution.replaceJournalRecords(
            await this.journalWriter.readRecords({
                agentExecutionId: prepared.executionId,
                scope: adapterPrepared.config.scope
            })
        );
        if (adapterPrepared.config.initialPrompt) {
            try {
                await this.recordInitialPromptDelivery(
                    this.requireManagedExecution(prepared.executionId),
                    adapterPrepared.config.initialPrompt
                );
            } catch (error) {
                await processDriver.terminate('Failed to record initial AgentExecution turn state.').catch(() => undefined);
                this.disposeManagedExecution(prepared.executionId);
                throw error;
            }
        }
        return processDriver.execution;
    }

    public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecution> {
        const adapter = this.agentRegistry.requireAgentAdapter(reference.agentId);
        if (AgentExecutor.isDelegatedRuntimeAdapter(adapter)) {
            return this.reconcileDelegatedExecution(adapter, reference);
        }
        const processDriver = AgentExecutionTerminalController.reconcile({
            ...adapter.terminalOptions,
            agentId: adapter.id,
            displayName: adapter.displayName,
            reference
        });
        const scope = processDriver.execution.getExecution().scope;
        this.trackExecution({
            processDriver,
            adapter,
            journalScope: scope,
            parseAgentSignals: false,
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(reference.agentExecutionId, scope)
        });
        processDriver.execution.replaceJournalRecords(
            await this.journalWriter.readRecords({
                agentExecutionId: reference.agentExecutionId,
                scope
            })
        );
        return processDriver.execution;
    }

    private async startDelegatedExecution(
        adapter: DelegatedRuntimeAgentAdapter,
        config: AgentLaunchConfig
    ): Promise<AgentExecution> {
        const execution = await adapter.startExecution(config);
        const snapshot = execution.getExecution();
        this.trackExecution({
            processDriver: AgentExecutor.createDelegatedProcessDriver(execution),
            adapter,
            journalScope: snapshot.scope,
            parseAgentSignals: false,
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(
                snapshot.agentExecutionId,
                snapshot.scope
            )
        });
        return execution;
    }

    private async reconcileDelegatedExecution(
        adapter: DelegatedRuntimeAgentAdapter,
        reference: AgentExecutionReference
    ): Promise<AgentExecution> {
        const execution = await adapter.reconcileExecution(reference);
        const snapshot = execution.getExecution();
        this.trackExecution({
            processDriver: AgentExecutor.createDelegatedProcessDriver(execution),
            adapter,
            journalScope: snapshot.scope,
            parseAgentSignals: false,
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(
                snapshot.agentExecutionId,
                snapshot.scope
            )
        });
        return execution;
    }

    public async submitPrompt(agentExecutionId: string, prompt: AgentPrompt): Promise<AgentExecutionType> {
        const managed = this.requireManagedExecution(agentExecutionId);
        const deliveryTransport = this.resolveDeliveryTransport(managed);
        const accepted = await this.journalWriter.appendPromptAccepted({
            agentExecutionId,
            scope: managed.journalScope,
            prompt
        });
        this.publishJournalRecord(managed, accepted);
        this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
            agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'attempted',
            transport: deliveryTransport
        }));
        try {
            const snapshot = await managed.processDriver.submitPrompt(prompt);
            this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'delivered',
                transport: deliveryTransport
            }));
            await this.promoteDeliveredTurnMessage(managed, accepted.messageId, snapshot, prompt);
            return snapshot;
        } catch (error) {
            this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'failed',
                transport: deliveryTransport,
                reason: error instanceof Error ? error.message : String(error)
            }));
            throw error;
        }
    }

    public async submitCommand(agentExecutionId: string, command: AgentCommand): Promise<AgentExecutionType> {
        const managed = this.requireManagedExecution(agentExecutionId);
        const deliveryTransport = this.resolveDeliveryTransport(managed);
        const accepted = await this.journalWriter.appendCommandAccepted({
            agentExecutionId,
            scope: managed.journalScope,
            command
        });
        this.publishJournalRecord(managed, accepted);
        this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
            agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'attempted',
            transport: deliveryTransport
        }));
        try {
            const snapshot = await managed.processDriver.submitCommand(command);
            this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'delivered',
                transport: deliveryTransport
            }));
            await this.promoteDeliveredTurnMessage(managed, accepted.messageId, snapshot, command);
            return snapshot;
        } catch (error) {
            this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'failed',
                transport: deliveryTransport,
                reason: error instanceof Error ? error.message : String(error)
            }));
            throw error;
        }
    }

    public async completeExecution(agentExecutionId: string): Promise<AgentExecutionType> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.processDriver.complete();
    }

    public async cancelExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionType> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.processDriver.cancel(reason);
    }

    public async terminateExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionType> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.processDriver.terminate(reason);
    }

    public getExecutionSnapshot(agentExecutionId: string): AgentExecutionType | undefined {
        return this.managedExecutions.get(agentExecutionId)?.execution.getExecution();
    }

    public async routeTransportObservation(input: {
        agentExecutionId: string;
        observation: AgentExecutionObservation;
    }): Promise<AgentExecutionObservationAckType> {
        const managed = this.requireManagedExecution(input.agentExecutionId);
        return this.observationCoordinator.routeTransportObservation(managed, input.observation, {
            publishJournalRecord: (record) => {
                this.publishJournalRecord(managed, record);
            },
            disposeManagedExecution: () => {
                this.disposeManagedExecution(input.agentExecutionId);
            }
        });
    }

    public async invokeSemanticOperation(input: AgentExecutionSemanticOperationInvocationType): Promise<AgentExecutionSemanticOperationResultType> {
        const managed = this.requireManagedExecution(input.agentExecutionId);
        return this.semanticOperations.invoke({
            ...input,
            scope: managed.journalScope,
            onRecordAppended: (record) => {
                this.publishJournalRecord(managed, record);
            }
        });
    }

    public async readArtifact(agentExecutionId: string, artifactPath: string): Promise<AgentExecutionSemanticOperationResultType> {
        return this.invokeSemanticOperation({
            agentExecutionId,
            name: 'read_artifact',
            input: {
                path: artifactPath
            }
        });
    }

    private async prepareLaunch(
        config: AgentLaunchConfig,
        executionId: string,
        selectedDelivery: AgentSignalDeliveryType,
        launchMode: 'interactive' | 'print',
        adapterSupportedMessages: AgentExecutionMessageDescriptorType[]
    ): Promise<{
        config: AgentLaunchConfig;
        executionId: string;
        protocolDescriptor: AgentExecutionProtocolDescriptorType;
        transportState: AgentExecutionTransportStateType;
    }> {
        const protocolDescriptor = createAgentExecutionProtocolDescriptor({
            scope: config.scope,
            interactionPosture: launchMode === 'print' ? 'structured-headless' : 'structured-interactive',
            deliveries: [selectedDelivery],
            messages: mergeAgentExecutionMessageDescriptors(
                AgentExecution.createSupportedMessagesForCommands(['interrupt', 'checkpoint', 'nudge']),
                adapterSupportedMessages
            )
        });
        const transportState: AgentExecutionTransportStateType = {
            selected: selectedDelivery,
            degraded: false
        };

        const launchContext = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: executionId,
            protocolDescriptor
        });

        return {
            executionId,
            protocolDescriptor,
            transportState,
            config: {
                ...config,
                initialPrompt: config.initialPrompt
                    ? {
                        ...config.initialPrompt,
                        text: `${launchContext.agentExecutionInstructions}\n\n${config.initialPrompt.text}`
                    }
                    : {
                        source: 'system',
                        text: launchContext.agentExecutionInstructions
                    },
                launchEnv: {
                    ...(config.launchEnv ?? {}),
                    ...launchContext.launchEnv
                }
            }
        };
    }

    private static isDelegatedRuntimeAdapter(adapter: AgentAdapter): adapter is DelegatedRuntimeAgentAdapter {
        return 'startExecution' in adapter
            && typeof adapter.startExecution === 'function'
            && 'reconcileExecution' in adapter
            && typeof adapter.reconcileExecution === 'function';
    }

    private static createDelegatedProcessDriver(execution: AgentExecution): AgentExecutionProcessDriver {
        const delegatedExecution = execution as AgentExecution & {
            complete?: () => Promise<AgentExecutionType>;
        };
        return {
            execution,
            submitPrompt: (prompt) => execution.submitPrompt(prompt),
            submitCommand: (command) => execution.submitCommand(command),
            complete: () => delegatedExecution.complete ? delegatedExecution.complete() : execution.getExecution(),
            cancel: (reason) => execution.cancel(reason),
            terminate: (reason) => execution.terminate(reason),
            dispose: () => undefined
        };
    }

    private selectSignalDelivery(adapter: AgentAdapter, launchMode: 'interactive' | 'print'): AgentSignalDeliveryType {
        const capabilities = adapter.getTransportCapabilities();
        const preferredDelivery = capabilities.preferred[launchMode];
        if (preferredDelivery) {
            if (!capabilities.supported.includes(preferredDelivery)) {
                throw new Error(`AgentAdapter '${adapter.id}' prefers unsupported AgentExecution signal delivery '${preferredDelivery}'.`);
            }
            if (preferredDelivery === 'mcp-tool' && !this.openMissionMcpServer) {
                throw new Error(`AgentAdapter '${adapter.id}' selected mcp-tool delivery but open-mission-mcp is unavailable.`);
            }
            return preferredDelivery;
        }
        if (capabilities.supported.includes('stdout-marker')) {
            return 'stdout-marker';
        }
        if (capabilities.supported.includes('mcp-tool')) {
            if (!this.openMissionMcpServer) {
                throw new Error(`AgentAdapter '${adapter.id}' selected mcp-tool delivery but open-mission-mcp is unavailable.`);
            }
            return 'mcp-tool';
        }
        throw new Error(`AgentAdapter '${adapter.id}' does not support an AgentExecution signal delivery for launch mode '${launchMode}'.`);
    }

    private registerMcpAccess(agentExecutionId: string, protocolDescriptor: AgentExecutionProtocolDescriptorType): AgentExecutionMcpAccess {
        if (!this.openMissionMcpServer) {
            throw new Error(`AgentExecution '${agentExecutionId}' selected mcp-tool delivery but open-mission-mcp is unavailable.`);
        }
        const access = this.openMissionMcpServer.registerAccess({ agentExecutionId, protocolDescriptor });
        return {
            serverName: access.serverName,
            agentExecutionId: access.agentExecutionId,
            ownerId: readAgentExecutionOwnerId(protocolDescriptor.scope as AgentExecutionProtocolDescriptorType['scope']),
            token: access.token,
            tools: access.tools.map((tool) => ({ name: tool.name }))
        };
    }

    private trackExecution(input: {
        processDriver: AgentExecutionProcessDriver;
        adapter: AgentAdapter;
        journalScope: AgentExecutionScope;
        observationLedger: AgentExecutionObservationLedger;
        parseAgentSignals: boolean;
        cleanup?: () => Promise<void>;
    }): void {
        const execution = input.processDriver.execution;
        const agentExecutionId = execution.getExecution().agentExecutionId;
        this.disposeManagedExecution(agentExecutionId);
        const eventSubscription = execution.onDidEvent((event) => this.handleExecutionEvent(agentExecutionId, event));
        this.managedExecutions.set(agentExecutionId, {
            execution,
            processDriver: input.processDriver,
            adapter: input.adapter,
            eventSubscription,
            retainedProcessOutput: '',
            retainProcessOutput: input.adapter.supportsUsageParsing(),
            journalScope: input.journalScope,
            parseAgentSignals: input.parseAgentSignals,
            observationLedger: input.observationLedger,
            observationPolicy: new AgentExecutionObservationPolicy(input.observationLedger),
            observationQueue: Promise.resolve(),
            idleObservationTimer: undefined,
            ...(input.cleanup ? { cleanup: input.cleanup } : {})
        });
        this.observationCoordinator.syncIdleObservationTimer(this.requireManagedExecution(agentExecutionId), execution.getExecution(), {
            publishJournalRecord: (record) => {
                const managed = this.managedExecutions.get(agentExecutionId);
                if (managed) {
                    this.publishJournalRecord(managed, record);
                }
            },
            disposeManagedExecution: () => {
                this.disposeManagedExecution(agentExecutionId);
            }
        });
    }

    private handleExecutionEvent(agentExecutionId: string, event: AgentExecutionEvent): void {
        const managed = this.managedExecutions.get(agentExecutionId);
        if (!managed) {
            return;
        }
        this.observationCoordinator.handleExecutionEvent(managed, event, {
            publishJournalRecord: (record) => {
                const currentManaged = this.managedExecutions.get(agentExecutionId);
                if (currentManaged) {
                    this.publishJournalRecord(currentManaged, record);
                }
            },
            disposeManagedExecution: () => {
                this.disposeManagedExecution(agentExecutionId);
            }
        });
    }

    private resolveDeliveryTransport(managed: ManagedAgentExecution): 'pty-terminal' | 'agent-message' {
        return managed.execution.getExecution().transport?.kind === 'terminal' ? 'pty-terminal' : 'agent-message';
    }

    private async recordInitialPromptDelivery(
        managed: ManagedAgentExecution,
        prompt: AgentPrompt
    ): Promise<void> {
        const deliveryTransport = this.resolveDeliveryTransport(managed);
        const accepted = await this.journalWriter.appendPromptAccepted({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            prompt
        });
        this.publishJournalRecord(managed, accepted);
        this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'attempted',
            transport: deliveryTransport
        }));
        const snapshot = managed.execution.getExecution();
        this.publishJournalRecord(managed, await this.journalWriter.appendMessageDelivery({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'delivered',
            transport: deliveryTransport
        }));
        await this.promoteDeliveredTurnMessage(managed, accepted.messageId, snapshot, prompt);
    }

    private async promoteDeliveredTurnMessage(
        managed: ManagedAgentExecution,
        messageId: string,
        snapshot: AgentExecutionType,
        message: AgentPrompt | AgentCommand
    ): Promise<void> {
        if (!startsAgentExecutionTurn(message)) {
            return;
        }
        this.publishJournalRecord(managed, await this.journalWriter.appendExecutionStateChanged({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            lifecycle: snapshot.status,
            attention: snapshot.attention,
            activity: 'awaiting-agent-response',
            awaitingResponseToMessageId: messageId
        }));
        managed.execution.setAwaitingResponseToMessageId(messageId, snapshot.updatedAt);
    }

    private publishJournalRecord(
        managed: ManagedAgentExecution,
        record: AgentExecutionJournalRecordType | undefined
    ): void {
        if (!record) {
            return;
        }

        managed.execution.appendJournalRecord(record, { notify: true });
    }

    private requireManagedExecution(agentExecutionId: string): ManagedAgentExecution {
        const managed = this.managedExecutions.get(agentExecutionId);
        if (!managed) {
            throw new Error(`AgentExecution '${agentExecutionId}' is not managed by AgentExecutor.`);
        }
        return managed;
    }

    private disposeManagedExecution(agentExecutionId: string): void {
        const managed = this.managedExecutions.get(agentExecutionId);
        if (!managed) {
            return;
        }
        this.observationCoordinator.dispose(managed);
        managed.eventSubscription.dispose();
        managed.processDriver.dispose();
        this.managedExecutions.delete(agentExecutionId);
        void managed.cleanup?.();
    }
}

function mergeAgentExecutionMessageDescriptors(
    baseMessages: AgentExecutionMessageDescriptorType[],
    additionalMessages: AgentExecutionMessageDescriptorType[]
): AgentExecutionMessageDescriptorType[] {
    const seenTypes = new Set(baseMessages.map((message) => message.type));
    return [
        ...baseMessages,
        ...additionalMessages.filter((message) => {
            if (seenTypes.has(message.type)) {
                return false;
            }
            seenTypes.add(message.type);
            return true;
        })
    ];
}

function readAgentExecutionOwnerId(scope: AgentExecutionProtocolDescriptorType['scope']): string {
    switch (scope.kind) {
        case 'system':
            return scope.label?.trim() || 'system';
        case 'repository':
            return scope.repositoryRootPath;
        case 'mission':
        case 'task':
            return scope.missionId;
        case 'artifact':
            return scope.artifactId;
    }
}

function startsAgentExecutionTurn(message: AgentPrompt | AgentCommand): boolean {
    if ('source' in message) {
        return true;
    }
    return message.type !== 'interrupt';
}

function combineCleanup(
    first: (() => Promise<void>) | undefined,
    second: (() => Promise<void>) | undefined
): (() => Promise<void>) | undefined {
    if (!first) {
        return second;
    }
    if (!second) {
        return first;
    }
    return async () => {
        try {
            await first();
        } finally {
            await second();
        }
    };
}

