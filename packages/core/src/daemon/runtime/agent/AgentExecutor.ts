import { createAgentExecutionProtocolDescriptor } from '../../../entities/AgentExecution/AgentExecutionProtocolDescriptor.js';
import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    createDefaultAgentExecutionJournalWriter,
    type AgentExecutionJournalWriter
} from '../../../entities/AgentExecution/AgentExecutionJournalWriter.js';
import type { AgentExecutionJournalRecordType } from '../../../entities/AgentExecution/AgentExecutionJournalSchema.js';
import {
    AgentExecutionObservationLedger,
    AgentExecutionObservationPolicy
} from '../../../entities/AgentExecution/AgentExecutionObservationPolicy.js';
import type {
    AgentCommand,
    AgentExecutionEvent,
    AgentExecutionObservation,
    AgentExecutionReference,
    AgentExecutionScope,
    AgentExecutionSnapshot,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionObservationAckType,
    AgentExecutionProtocolDescriptorType,
    AgentExecutionTransportStateType,
    AgentSignalDeliveryType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import type { AgentAdapter, AgentExecutionMcpAccess } from './AgentAdapter.js';
import {
    AgentExecutionObservationCoordinator
} from './AgentExecutionObservationCoordinator.js';
import { AgentExecutionFactRecorder } from './AgentExecutionFactRecorder.js';
import { AgentExecutionProcessController } from './AgentExecutionProcessController.js';
import {
    AgentExecutionSemanticOperations,
    type AgentExecutionSemanticOperationInvocationType,
    type AgentExecutionSemanticOperationResultType
} from './AgentExecutionSemanticOperations.js';
import { AgentExecutionTerminalController } from './AgentExecutionTerminalController.js';
import type {
    AgentExecutionRuntimeController
} from './AgentExecutionRuntimeController.js';
import { ArtifactService } from './ArtifactService.js';
import type { MissionMcpServer } from './mcp/MissionMcpServer.js';
import { buildAgentExecutionSignalLaunchContext } from './signals/AgentExecutionSignalLaunchContext.js';
import { AgentExecutionObservationRouter } from './signals/AgentExecutionObservationRouter.js';

export { AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS } from './AgentExecutionObservationCoordinator.js';

export type AgentExecutorOptions = {
    agentRegistry: AgentRegistry;
    missionMcpServer?: MissionMcpServer;
    journalWriter?: AgentExecutionJournalWriter;
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

type ManagedAgentExecution = {
    execution: AgentExecution;
    runtimeController: AgentExecutionRuntimeController;
    adapter: AgentAdapter;
    eventSubscription: { dispose(): void };
    retainedRuntimeOutput: string;
    retainRuntimeOutput: boolean;
    journalScope: AgentExecutionScope;
    parseAgentSignals: boolean;
    observationLedger: AgentExecutionObservationLedger;
    observationPolicy: AgentExecutionObservationPolicy;
    observationQueue: Promise<void>;
    idleObservationTimer: NodeJS.Timeout | undefined;
    cleanup?: () => Promise<void>;
};

export class AgentExecutor {
    private readonly agentRegistry: AgentRegistry;
    private readonly journalWriter: AgentExecutionJournalWriter;
    private readonly missionMcpServer: MissionMcpServer | undefined;
    private readonly observationCoordinator: AgentExecutionObservationCoordinator;
    private readonly semanticOperations: AgentExecutionSemanticOperations;
    private readonly managedExecutions = new Map<string, ManagedAgentExecution>();

    public constructor(options: AgentExecutorOptions) {
        this.agentRegistry = options.agentRegistry;
        this.journalWriter = options.journalWriter ?? createDefaultAgentExecutionJournalWriter();
        this.missionMcpServer = options.missionMcpServer;
        const observationRouter = new AgentExecutionObservationRouter({
            ...(options.logger ? { logger: options.logger } : {})
        });
        this.observationCoordinator = new AgentExecutionObservationCoordinator({
            journalWriter: this.journalWriter,
            observationRouter
        });
        this.semanticOperations = new AgentExecutionSemanticOperations({
            artifactService: new ArtifactService(),
            factRecorder: new AgentExecutionFactRecorder({
                journalWriter: this.journalWriter
            })
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

        const executionId = AgentExecution.createFreshExecutionId(config, adapter.id);
        const preliminaryLaunchPlan = adapter.createLaunchPlan(config);
        const selectedDelivery = this.selectSignalDelivery(adapter, preliminaryLaunchPlan.mode);
        const prepared = await this.prepareLaunch(config, executionId, selectedDelivery);
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
        const runtimeController = launchPlan.mode === 'print'
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
            this.missionMcpServer?.unregisterAccess(prepared.executionId);
        } : undefined);
        this.trackExecution({
            runtimeController,
            adapter,
            journalScope: adapterPrepared.config.scope,
            parseAgentSignals: selectedDelivery === 'stdout-marker',
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(prepared.executionId, adapterPrepared.config.scope),
            ...(cleanup ? { cleanup } : {})
        });
        runtimeController.execution.replaceJournalRecords(
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
                await runtimeController.terminate('Failed to record initial AgentExecution turn state.').catch(() => undefined);
                this.disposeManagedExecution(prepared.executionId);
                throw error;
            }
        }
        return runtimeController.execution;
    }

    public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecution> {
        const adapter = this.agentRegistry.requireAgentAdapter(reference.agentId);
        const runtimeController = AgentExecutionTerminalController.reconcile({
            ...adapter.terminalOptions,
            agentId: adapter.id,
            displayName: adapter.displayName,
            reference
        });
        const scope = runtimeController.execution.getSnapshot().scope;
        this.trackExecution({
            runtimeController,
            adapter,
            journalScope: scope,
            parseAgentSignals: false,
            observationLedger: await this.observationCoordinator.hydrateObservationLedger(reference.agentExecutionId, scope)
        });
        runtimeController.execution.replaceJournalRecords(
            await this.journalWriter.readRecords({
                agentExecutionId: reference.agentExecutionId,
                scope
            })
        );
        return runtimeController.execution;
    }

    public async submitPrompt(agentExecutionId: string, prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
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
            const snapshot = await managed.runtimeController.submitPrompt(prompt);
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

    public async submitCommand(agentExecutionId: string, command: AgentCommand): Promise<AgentExecutionSnapshot> {
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
            const snapshot = await managed.runtimeController.submitCommand(command);
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

    public async completeExecution(agentExecutionId: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.runtimeController.complete();
    }

    public async cancelExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.runtimeController.cancel(reason);
    }

    public async terminateExecution(agentExecutionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(agentExecutionId);
        return managed.runtimeController.terminate(reason);
    }

    public getExecutionSnapshot(agentExecutionId: string): AgentExecutionSnapshot | undefined {
        return this.managedExecutions.get(agentExecutionId)?.execution.getSnapshot();
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
        selectedDelivery: AgentSignalDeliveryType
    ): Promise<{
        config: AgentLaunchConfig;
        executionId: string;
        protocolDescriptor: AgentExecutionProtocolDescriptorType;
        transportState: AgentExecutionTransportStateType;
    }> {
        const protocolDescriptor = createAgentExecutionProtocolDescriptor({
            scope: config.scope,
            deliveries: [selectedDelivery],
            messages: AgentExecution.createRuntimeMessageDescriptorsForCommands(['interrupt', 'checkpoint', 'nudge'])
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

    private selectSignalDelivery(adapter: AgentAdapter, launchMode: 'interactive' | 'print'): AgentSignalDeliveryType {
        const capabilities = adapter.getTransportCapabilities();
        const preferredDelivery = capabilities.preferred[launchMode];
        if (preferredDelivery) {
            if (!capabilities.supported.includes(preferredDelivery)) {
                throw new Error(`AgentAdapter '${adapter.id}' prefers unsupported AgentExecution signal delivery '${preferredDelivery}'.`);
            }
            if (preferredDelivery === 'mcp-tool' && !this.missionMcpServer) {
                throw new Error(`AgentAdapter '${adapter.id}' selected mcp-tool delivery but mission-mcp is unavailable.`);
            }
            return preferredDelivery;
        }
        if (capabilities.supported.includes('stdout-marker')) {
            return 'stdout-marker';
        }
        if (capabilities.supported.includes('mcp-tool')) {
            if (!this.missionMcpServer) {
                throw new Error(`AgentAdapter '${adapter.id}' selected mcp-tool delivery but mission-mcp is unavailable.`);
            }
            return 'mcp-tool';
        }
        throw new Error(`AgentAdapter '${adapter.id}' does not support an AgentExecution signal delivery for launch mode '${launchMode}'.`);
    }

    private registerMcpAccess(agentExecutionId: string, protocolDescriptor: AgentExecutionProtocolDescriptorType): AgentExecutionMcpAccess {
        if (!this.missionMcpServer) {
            throw new Error(`AgentExecution '${agentExecutionId}' selected mcp-tool delivery but mission-mcp is unavailable.`);
        }
        const access = this.missionMcpServer.registerAccess({ agentExecutionId, protocolDescriptor });
        return {
            serverName: access.serverName,
            agentExecutionId: access.agentExecutionId,
            token: access.token,
            tools: access.tools.map((tool) => ({ name: tool.name }))
        };
    }

    private trackExecution(input: {
        runtimeController: AgentExecutionRuntimeController;
        adapter: AgentAdapter;
        journalScope: AgentExecutionScope;
        observationLedger: AgentExecutionObservationLedger;
        parseAgentSignals: boolean;
        cleanup?: () => Promise<void>;
    }): void {
        const execution = input.runtimeController.execution;
        const agentExecutionId = execution.getSnapshot().agentExecutionId;
        this.disposeManagedExecution(agentExecutionId);
        const eventSubscription = execution.onDidEvent((event) => this.handleExecutionEvent(agentExecutionId, event));
        this.managedExecutions.set(agentExecutionId, {
            execution,
            runtimeController: input.runtimeController,
            adapter: input.adapter,
            eventSubscription,
            retainedRuntimeOutput: '',
            retainRuntimeOutput: input.adapter.supportsUsageParsing(),
            journalScope: input.journalScope,
            parseAgentSignals: input.parseAgentSignals,
            observationLedger: input.observationLedger,
            observationPolicy: new AgentExecutionObservationPolicy(input.observationLedger),
            observationQueue: Promise.resolve(),
            idleObservationTimer: undefined,
            ...(input.cleanup ? { cleanup: input.cleanup } : {})
        });
        this.observationCoordinator.syncIdleObservationTimer(this.requireManagedExecution(agentExecutionId), execution.getSnapshot(), {
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
        return managed.execution.getSnapshot().transport?.kind === 'terminal' ? 'pty-terminal' : 'agent-message';
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
        const snapshot = managed.execution.getSnapshot();
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
        snapshot: AgentExecutionSnapshot,
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
        managed.runtimeController.dispose();
        this.managedExecutions.delete(agentExecutionId);
        void managed.cleanup?.();
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

