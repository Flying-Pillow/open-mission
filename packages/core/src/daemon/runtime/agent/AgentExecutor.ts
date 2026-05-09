import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createAgentExecutionProtocolDescriptor } from '../../../entities/AgentExecution/AgentExecutionProtocolDescriptor.js';
import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    createDefaultAgentExecutionJournalWriter,
    type AgentExecutionJournalWriter
} from '../../../entities/AgentExecution/AgentExecutionJournalWriter.js';
import type {
    AgentCommand,
    AgentExecutionEvent,
    AgentExecutionObservationAddress,
    AgentExecutionReference,
    AgentExecutionScope,
    AgentExecutionSnapshot,
    AgentLaunchConfig,
    AgentPrompt,
    AgentTaskContext
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import {
    deriveAgentExecutionInteractionCapabilities,
    describeAgentExecutionScope,
    getAgentExecutionScopeMissionId,
    getAgentExecutionScopeStageId,
    getAgentExecutionScopeTaskId
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import {
    AgentExecutionObservationAckSchema,
    type AgentDeclaredSignalDeliveryType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionTransportStateType,
    type AgentExecutionObservationAckType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import { Repository } from '../../../entities/Repository/Repository.js';
import {
    TerminalRegistry,
    type SharedTerminalRegistryOptions,
    type TerminalHandle,
    type TerminalOwner,
    type TerminalSnapshot,
    type TerminalState
} from '../../../entities/Terminal/TerminalRegistry.js';
import type { AgentAdapter, AgentExecutionMcpAccess } from './AgentAdapter.js';
import {
    AgentExecutionObservationLedger,
    AgentExecutionObservationPolicy
} from '../../../entities/AgentExecution/AgentExecutionObservationPolicy.js';
import { buildAgentExecutionSignalLaunchContext } from './signals/AgentExecutionSignalLaunchContext.js';
import { AgentExecutionObservationRouter } from './signals/AgentExecutionObservationRouter.js';
import type { AgentExecutionObservation } from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type { MissionMcpServer } from './mcp/MissionMcpServer.js';
import { replayAgentExecutionJournal } from '../../../entities/AgentExecution/AgentExecutionJournalReplayer.js';

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
    outputLines: string[];
    journalScope: AgentExecutionScope;
    parseAgentDeclaredSignals: boolean;
    observationLedger: AgentExecutionObservationLedger;
    observationPolicy: AgentExecutionObservationPolicy;
    observationQueue: Promise<void>;
    cleanup?: () => Promise<void>;
};

type AgentExecutionRuntimeController = {
    readonly execution: AgentExecution;
    submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
    complete(): Promise<AgentExecutionSnapshot>;
    cancel(reason?: string): Promise<AgentExecutionSnapshot>;
    terminate(reason?: string): Promise<AgentExecutionSnapshot>;
    dispose(): void;
};

type AgentExecutionTerminalOptions = SharedTerminalRegistryOptions & {
    terminalPrefix?: string;
};

type AgentExecutionLaunch = {
    command: string;
    args?: string[];
    stdin?: string;
    env?: NodeJS.ProcessEnv;
    agentExecutionId?: string;
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    terminalPrefix?: string;
    skipInitialPromptSubmission?: boolean;
};

type AgentExecutionTerminalStartOptions = AgentExecutionTerminalOptions & {
    agentId: string;
    displayName: string;
    config: AgentLaunchConfig;
    launch: AgentExecutionLaunch;
};

type AgentExecutionTerminalReconcileOptions = AgentExecutionTerminalOptions & {
    agentId: string;
    reference: AgentExecutionReference;
};

export class AgentExecutor {
    private readonly agentRegistry: AgentRegistry;
    private readonly journalWriter: AgentExecutionJournalWriter;
    private readonly missionMcpServer: MissionMcpServer | undefined;
    private readonly observationRouter: AgentExecutionObservationRouter;
    private readonly managedExecutions = new Map<string, ManagedAgentExecution>();

    public constructor(options: AgentExecutorOptions) {
        this.agentRegistry = options.agentRegistry;
        this.journalWriter = options.journalWriter ?? createDefaultAgentExecutionJournalWriter();
        this.missionMcpServer = options.missionMcpServer;
        this.observationRouter = new AgentExecutionObservationRouter({
            ...(options.logger ? { logger: options.logger } : {})
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
            parseAgentDeclaredSignals: selectedDelivery === 'stdout-marker',
            observationLedger: await this.hydrateObservationLedger(prepared.executionId, adapterPrepared.config.scope),
            ...(cleanup ? { cleanup } : {})
        });
        return runtimeController.execution;
    }

    public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecution> {
        const adapter = this.agentRegistry.requireAgentAdapter(reference.agentId);
        const runtimeController = AgentExecutionTerminalController.reconcile({
            ...adapter.terminalOptions,
            agentId: adapter.id,
            reference
        });
        const scope = runtimeController.execution.getSnapshot().scope;
        this.trackExecution({
            runtimeController,
            adapter,
            journalScope: scope,
            parseAgentDeclaredSignals: false,
            observationLedger: await this.hydrateObservationLedger(reference.agentExecutionId, scope)
        });
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
        await this.journalWriter.appendMessageDelivery({
            agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'attempted',
            transport: deliveryTransport
        });
        try {
            const snapshot = await managed.runtimeController.submitPrompt(prompt);
            await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'delivered',
                transport: deliveryTransport
            });
            return snapshot;
        } catch (error) {
            await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'failed',
                transport: deliveryTransport,
                reason: error instanceof Error ? error.message : String(error)
            });
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
        await this.journalWriter.appendMessageDelivery({
            agentExecutionId,
            scope: managed.journalScope,
            messageId: accepted.messageId,
            status: 'attempted',
            transport: deliveryTransport
        });
        try {
            const snapshot = await managed.runtimeController.submitCommand(command);
            await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'delivered',
                transport: deliveryTransport
            });
            return snapshot;
        } catch (error) {
            await this.journalWriter.appendMessageDelivery({
                agentExecutionId,
                scope: managed.journalScope,
                messageId: accepted.messageId,
                status: 'failed',
                transport: deliveryTransport,
                reason: error instanceof Error ? error.message : String(error)
            });
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
        return this.enqueueObservation(managed, input.observation);
    }

    private async prepareLaunch(
        config: AgentLaunchConfig,
        executionId: string,
        selectedDelivery: AgentDeclaredSignalDeliveryType
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

    private selectSignalDelivery(adapter: AgentAdapter, launchMode: 'interactive' | 'print'): AgentDeclaredSignalDeliveryType {
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
        parseAgentDeclaredSignals: boolean;
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
            outputLines: [],
            journalScope: input.journalScope,
            parseAgentDeclaredSignals: input.parseAgentDeclaredSignals,
            observationLedger: input.observationLedger,
            observationPolicy: new AgentExecutionObservationPolicy(input.observationLedger),
            observationQueue: Promise.resolve(),
            ...(input.cleanup ? { cleanup: input.cleanup } : {})
        });
    }

    private handleExecutionEvent(agentExecutionId: string, event: AgentExecutionEvent): void {
        const managed = this.managedExecutions.get(agentExecutionId);
        if (!managed) {
            return;
        }
        switch (event.type) {
            case 'execution.message':
                if (event.channel !== 'stdout' && event.channel !== 'stderr') {
                    return;
                }
                managed.outputLines.push(event.text);
                this.routeRuntimeOutput(managed, event.snapshot, event.channel, event.text);
                return;
            case 'execution.completed':
            case 'execution.failed':
                void this.routeUsageObservation(managed, event.snapshot)
                    .finally(() => this.disposeManagedExecution(agentExecutionId));
                return;
            case 'execution.cancelled':
            case 'execution.terminated':
                this.disposeManagedExecution(agentExecutionId);
                return;
            case 'execution.attached':
            case 'execution.awaiting-input':
            case 'execution.started':
            case 'execution.updated':
                return;
        }
    }

    private routeRuntimeOutput(
        managed: ManagedAgentExecution,
        snapshot: AgentExecutionSnapshot,
        channel: 'stdout' | 'stderr',
        line: string
    ): void {
        const observationAddress = toObservationAddress(snapshot);
        const markerPrefix = AgentExecution.createProtocolDescriptorForSnapshot(snapshot).owner.markerPrefix;
        if (managed.parseAgentDeclaredSignals && channel === 'stdout') {
            const observations = this.observationRouter.route({
                kind: 'agent-declared-signal',
                line,
                address: observationAddress,
                markerPrefix,
                observedAt: snapshot.updatedAt
            });
            void this.applyObservations(managed, observations);
            if (observations.length === 0 && isDirectAgentProseLine(line)) {
                managed.execution.emitEvent({
                    type: 'execution.message',
                    channel: 'agent',
                    text: line,
                    snapshot: managed.execution.getSnapshot()
                });
            }
        }
        for (const observation of managed.adapter.parseRuntimeOutputLine(line)) {
            void this.applyObservations(managed, this.observationRouter.route({
                kind: 'provider-output',
                observation,
                address: observationAddress,
                observedAt: snapshot.updatedAt
            }));
        }
        void this.applyObservations(managed, this.observationRouter.route({
            kind: 'terminal-output',
            line,
            channel,
            address: observationAddress,
            markerPrefix,
            observedAt: snapshot.updatedAt
        }));
    }

    private async routeUsageObservation(managed: ManagedAgentExecution, snapshot: AgentExecutionSnapshot): Promise<void> {
        const observationAddress = toObservationAddress(snapshot);
        const usageObservation = managed.adapter.parseAgentExecutionUsageContent(managed.outputLines.join('\n'));
        if (!usageObservation) {
            return;
        }
        await this.applyObservations(managed, this.observationRouter.route({
            kind: 'provider-output',
            observation: usageObservation,
            address: observationAddress,
            observedAt: snapshot.updatedAt
        }));
    }

    private async applyObservations(managed: ManagedAgentExecution, observations: AgentExecutionObservation[]): Promise<void> {
        for (const observation of observations) {
            await this.enqueueObservation(managed, observation);
        }
    }

    private enqueueObservation(managed: ManagedAgentExecution, observation: AgentExecutionObservation): Promise<AgentExecutionObservationAckType> {
        const queued = managed.observationQueue.then(() => this.applyObservation(managed, observation));
        managed.observationQueue = queued.then(() => undefined, () => undefined);
        return queued;
    }

    private async applyObservation(managed: ManagedAgentExecution, observation: AgentExecutionObservation): Promise<AgentExecutionObservationAckType> {
        const eventId = readObservationEventId(observation);
        if (managed.observationLedger.has(observation.observationId)) {
            return AgentExecutionObservationAckSchema.parse({
                status: 'duplicate',
                agentExecutionId: managed.execution.agentExecutionId,
                eventId,
                observationId: observation.observationId,
                reason: `Observation '${observation.observationId}' was already processed.`
            });
        }
        await this.journalWriter.appendObservation({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            observation
        });
        const decision = managed.observationPolicy.evaluate({
            snapshot: managed.execution.getSnapshot(),
            observation
        });
        await this.journalWriter.appendDecision({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            observationId: observation.observationId,
            decision
        });
        if (decision.action === 'reject') {
            return AgentExecutionObservationAckSchema.parse({
                status: isDuplicateObservationRejection(decision.reason) ? 'duplicate' : 'rejected',
                agentExecutionId: managed.execution.agentExecutionId,
                eventId,
                observationId: observation.observationId,
                reason: decision.reason
            });
        }
        if (decision.action === 'update-execution') {
            const currentInputRequestId = decision.eventType === 'execution.awaiting-input'
                ? observation.observationId
                : decision.snapshotPatch.waitingForInput === false
                    ? null
                    : undefined;
            await this.journalWriter.appendStateChanged({
                agentExecutionId: managed.execution.agentExecutionId,
                scope: managed.journalScope,
                decision,
                ...(currentInputRequestId !== undefined ? { currentInputRequestId } : {})
            });
            await this.journalWriter.appendActivityUpdated({
                agentExecutionId: managed.execution.agentExecutionId,
                scope: managed.journalScope,
                decision
            });
        }
        managed.execution.applySignalObservation(observation, decision);
        return AgentExecutionObservationAckSchema.parse({
            status: decision.action === 'record-observation-only' ? 'recorded-only' : 'promoted',
            agentExecutionId: managed.execution.agentExecutionId,
            eventId,
            observationId: observation.observationId,
            ...(decision.action === 'record-observation-only' ? { reason: decision.reason } : {})
        });
    }

    private async hydrateObservationLedger(agentExecutionId: string, scope: AgentExecutionScope): Promise<AgentExecutionObservationLedger> {
        const records = await this.journalWriter.readRecords({ agentExecutionId, scope });
        return new AgentExecutionObservationLedger(replayAgentExecutionJournal(records).processedObservationIds);
    }

    private resolveDeliveryTransport(managed: ManagedAgentExecution): 'pty-terminal' | 'agent-message' {
        return managed.execution.getSnapshot().transport?.kind === 'terminal' ? 'pty-terminal' : 'agent-message';
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
        managed.eventSubscription.dispose();
        managed.runtimeController.dispose();
        this.managedExecutions.delete(agentExecutionId);
        void managed.cleanup?.();
    }
}

class AgentExecutionProcessController implements AgentExecutionRuntimeController {
    public readonly execution: AgentExecution;
    private child: ChildProcessWithoutNullStreams | undefined;
    private readonly lineBuffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    private disposed = false;

    private constructor(input: {
        execution: AgentExecution;
        command: string;
        args?: string[];
        workingDirectory: string;
        env?: NodeJS.ProcessEnv;
        stdin?: string;
    }) {
        this.execution = input.execution;
        queueMicrotask(() => this.startProcess(input));
    }

    public static start(options: AgentExecutionTerminalStartOptions): AgentExecutionProcessController {
        const agentId = options.agentId.trim();
        const agentExecutionId = options.launch.agentExecutionId?.trim() || AgentExecution.createFreshExecutionId(options.config, agentId);
        const execution = AgentExecution.createLive(createProcessRunningSnapshot({
            agentId,
            agentExecutionId,
            scope: options.config.scope,
            workingDirectory: options.config.workingDirectory,
            ...(options.config.task ? { task: options.config.task } : {})
        }), createAgentExecutionLiveOptions(options.launch));
        return new AgentExecutionProcessController({
            execution,
            command: options.launch.command,
            args: options.launch.args ?? [],
            workingDirectory: options.config.workingDirectory,
            ...(options.launch.env ? { env: options.launch.env } : {}),
            ...(options.launch.stdin ?? options.config.initialPrompt?.text
                ? { stdin: options.launch.stdin ?? options.config.initialPrompt?.text ?? '' }
                : {})
        });
    }

    public submitPrompt(_prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
        throw new Error(`AgentExecution '${this.execution.agentExecutionId}' is running in direct stdout mode and does not accept follow-up prompts.`);
    }

    public submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot> {
        if (command.type === 'interrupt') {
            return this.cancel(command.reason);
        }
        throw new Error(`AgentExecution '${this.execution.agentExecutionId}' is running in direct stdout mode and only supports interruption.`);
    }

    public complete(): Promise<AgentExecutionSnapshot> {
        return this.execution.complete();
    }

    public async cancel(reason?: string): Promise<AgentExecutionSnapshot> {
        this.disposed = true;
        this.child?.kill('SIGINT');
        return this.execution.cancelRuntime(reason);
    }

    public async terminate(reason?: string): Promise<AgentExecutionSnapshot> {
        this.disposed = true;
        this.child?.kill('SIGTERM');
        return this.execution.terminateRuntime(reason);
    }

    public dispose(): void {
        this.disposed = true;
    }

    private startProcess(input: {
        command: string;
        args?: string[];
        workingDirectory: string;
        env?: NodeJS.ProcessEnv;
        stdin?: string;
    }): void {
        if (this.disposed) {
            return;
        }
        const child = spawn(input.command, input.args ?? [], {
            cwd: input.workingDirectory,
            env: input.env,
            stdio: 'pipe'
        });
        this.child = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string | Buffer) => this.consumeChunk('stdout', chunk));
        child.stderr.on('data', (chunk: string | Buffer) => this.consumeChunk('stderr', chunk));
        child.once('error', (error) => {
            void this.execution.terminateRuntime(error.message);
        });
        child.once('close', (code) => {
            this.flushBufferedLines();
            if (this.disposed) {
                return;
            }
            if (code === 0) {
                void this.execution.complete();
                return;
            }
            void this.execution.terminateRuntime(`Process exited with status ${String(code ?? 'unknown')}.`);
        });
        if (input.stdin !== undefined) {
            child.stdin.write(input.stdin);
        }
        child.stdin.end();
    }

    private consumeChunk(channel: 'stdout' | 'stderr', chunk: string | Buffer): void {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const segments = `${this.lineBuffers[channel]}${text}`.split(/\r?\n/u);
        this.lineBuffers[channel] = segments.pop() ?? '';
        for (const segment of segments) {
            this.emitOutputLine(channel, segment);
        }
    }

    private flushBufferedLines(): void {
        for (const channel of ['stdout', 'stderr'] as const) {
            const line = this.lineBuffers[channel];
            if (line) {
                this.emitOutputLine(channel, line);
            }
            this.lineBuffers[channel] = '';
        }
    }

    private emitOutputLine(channel: 'stdout' | 'stderr', line: string): void {
        if (!line) {
            return;
        }
        this.execution.emitEvent({
            type: 'execution.message',
            channel,
            text: line,
            snapshot: this.execution.getSnapshot()
        });
    }
}

class AgentExecutionTerminalController {
    public readonly execution: AgentExecution;
    private readonly registry: TerminalRegistry;
    private readonly terminalHandle: TerminalHandle | undefined;
    private readonly subscription: { dispose(): void } | undefined;

    private constructor(input: {
        registry: TerminalRegistry;
        execution: AgentExecution;
        terminalHandle?: TerminalHandle;
    }) {
        this.registry = input.registry;
        this.execution = input.execution;
        this.terminalHandle = input.terminalHandle;
        this.subscription = input.terminalHandle
            ? this.execution.attachTerminal({
                terminalName: input.terminalHandle.terminalName,
                source: this.registry
            })
            : undefined;
    }

    public static start(options: AgentExecutionTerminalStartOptions): AgentExecutionTerminalController {
        const agentId = options.agentId.trim();
        const displayName = options.displayName.trim();
        const command = options.launch.command.trim();
        if (!agentId || !displayName || !command) {
            throw new Error('AgentExecution requires agent id, display name, and command.');
        }

        const registry = TerminalRegistry.shared(options);
        const agentExecutionId = options.launch.agentExecutionId?.trim() || AgentExecution.createFreshExecutionId(options.config, agentId);
        const terminalHandle = registry.openTerminal({
            workingDirectory: options.config.workingDirectory,
            command,
            args: options.launch.args ?? [],
            ...(options.launch.env ? { env: options.launch.env } : {}),
            terminalPrefix: options.launch.terminalPrefix?.trim() || options.terminalPrefix?.trim() || 'mission-agent',
            terminalName: buildAgentExecutionTerminalName(
                options.config.workingDirectory,
                options.config.scope,
                agentExecutionId
            ),
            owner: toAgentExecutionTerminalOwner(options.config.scope, agentExecutionId)
        });
        const execution = AgentExecution.createLive(createRunningSnapshot({
            agentId,
            agentExecutionId,
            scope: options.config.scope,
            workingDirectory: options.config.workingDirectory,
            ...(options.config.task ? { task: options.config.task } : {}),
            transport: toSnapshotTransport(terminalHandle)
        }), createAgentExecutionLiveOptions(options.launch));
        const controller = new AgentExecutionTerminalController({ registry, execution, terminalHandle });

        if (!options.launch.skipInitialPromptSubmission && options.config.initialPrompt?.text) {
            void controller.submitPrompt(options.config.initialPrompt);
        }
        return controller;
    }

    public static reconcile(options: AgentExecutionTerminalReconcileOptions): AgentExecutionTerminalController {
        const agentId = options.agentId.trim();
        const registry = TerminalRegistry.shared(options);
        const terminalName = options.reference.transport?.terminalName ?? options.reference.agentExecutionId;
        const terminalHandle = registry.attachTerminal(terminalName);
        if (!terminalHandle) {
            return new AgentExecutionTerminalController({
                registry,
                execution: AgentExecution.createLive(createDetachedTerminalControllerSnapshot(
                    agentId,
                    options.reference,
                    'Terminal is no longer registered.'
                ))
            });
        }

        const terminalSnapshot = registry.readSnapshot(terminalHandle.terminalName);
        const owner = terminalSnapshot?.owner?.kind === 'agent-execution' ? terminalSnapshot.owner : undefined;
        const snapshot = terminalSnapshot?.dead
            ? createTerminalSnapshot({
                agentId,
                agentExecutionId: options.reference.agentExecutionId,
                scope: createDetachedAgentExecutionScope(owner),
                workingDirectory: terminalSnapshot.workingDirectory ?? 'unknown',
                transport: toSnapshotTransport(terminalHandle),
                status: terminalSnapshot.exitCode === 0 ? 'completed' : 'failed',
                progressState: terminalSnapshot.exitCode === 0 ? 'done' : 'failed',
                acceptsPrompts: false,
                acceptedCommands: [],
                ...(terminalSnapshot.exitCode === 0
                    ? {}
                    : { failureMessage: `terminal command exited with status ${String(terminalSnapshot.exitCode)}.` }),
                endedAt: new Date().toISOString()
            })
            : createRunningSnapshot({
                agentId,
                agentExecutionId: options.reference.agentExecutionId,
                scope: createDetachedAgentExecutionScope(owner),
                workingDirectory: terminalSnapshot?.workingDirectory ?? 'unknown',
                transport: toSnapshotTransport(terminalHandle)
            });
        return new AgentExecutionTerminalController({
            registry,
            execution: AgentExecution.createLive(snapshot),
            terminalHandle
        });
    }

    public complete(): Promise<AgentExecutionSnapshot> {
        this.requireTerminalHandle('mark the execution done');
        return this.execution.complete();
    }

    public submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
        const terminalHandle = this.requireTerminalHandle('submit a prompt');
        sendTerminalText(this.registry, terminalHandle, prompt.text);
        return this.execution.submitPrompt(prompt);
    }

    public submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot> {
        const terminalHandle = this.requireTerminalHandle(`perform '${command.type}'`);
        if (command.type === 'interrupt') {
            this.registry.sendKeys(terminalHandle.terminalName, 'C-c');
            return this.execution.submitCommand(command);
        }
        return this.submitPrompt(buildTerminalCommandPrompt(command));
    }

    public async cancel(reason?: string): Promise<AgentExecutionSnapshot> {
        const terminalHandle = this.requireTerminalHandle('cancel');
        this.registry.sendKeys(terminalHandle.terminalName, 'C-c');
        let terminalState = await waitForTerminalExit(this.registry, terminalHandle, 1_500);
        if (!terminalState.dead) {
            terminalState = await this.registry.killTerminal(terminalHandle.terminalName);
        }
        if (!terminalState.dead) {
            throw new Error(`Terminal '${terminalHandle.terminalName}' did not exit after cancellation was requested.`);
        }
        this.dispose();
        return this.execution.cancelRuntime(reason);
    }

    public async terminate(reason?: string): Promise<AgentExecutionSnapshot> {
        const terminalHandle = this.requireTerminalHandle('terminate');
        let terminalState = await this.registry.killTerminal(terminalHandle.terminalName);
        if (!terminalState.dead) {
            terminalState = await waitForTerminalExit(this.registry, terminalHandle, 5_000);
        }
        if (!terminalState.dead) {
            throw new Error(`Terminal '${terminalHandle.terminalName}' did not exit after termination was requested.`);
        }
        this.dispose();
        return this.execution.terminateRuntime(reason);
    }

    public dispose(): void {
        this.subscription?.dispose();
    }

    private requireTerminalHandle(action: string): TerminalHandle {
        if (!this.terminalHandle) {
            throw new Error(`Cannot ${action} for execution '${this.execution.agentExecutionId}' because it is not backed by an active terminal.`);
        }
        return this.terminalHandle;
    }
}

function toObservationAddress(snapshot: AgentExecutionSnapshot): AgentExecutionObservationAddress {
    return {
        agentExecutionId: snapshot.agentExecutionId,
        scope: snapshot.scope
    };
}

function toSnapshotTransport(handle: TerminalHandle): NonNullable<AgentExecutionSnapshot['transport']> {
    return {
        kind: 'terminal',
        terminalName: handle.terminalName,
        ...(handle.terminalPaneId !== handle.terminalName ? { terminalPaneId: handle.terminalPaneId } : {})
    };
}

function buildAgentExecutionTerminalName(
    workingDirectory: string,
    scope: AgentExecutionScope,
    agentExecutionId: string
): string {
    const repositoryId = Repository.deriveIdentity(workingDirectory).id;
    return [
        repositoryId,
        Repository.slugIdentitySegment(scope.kind) || 'scope',
        Repository.slugIdentitySegment(describeAgentExecutionScope(scope)) || 'execution',
        Repository.slugIdentitySegment(agentExecutionId) || 'execution'
    ].join(':');
}

function toAgentExecutionTerminalOwner(scope: AgentExecutionScope, agentExecutionId: string): TerminalOwner {
    return {
        kind: 'agent-execution',
        ownerId: getAgentExecutionTerminalOwnerId(scope),
        agentExecutionId
    };
}

function getAgentExecutionTerminalOwnerId(scope: AgentExecutionScope): string {
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

function isDirectAgentProseLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    return !/^@(system|repository|mission|task|artifact)::/u.test(trimmed);
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

function readObservationEventId(observation: AgentExecutionObservation): string {
    const prefix = 'agent-declared-signal:';
    if (observation.observationId.startsWith(prefix)) {
        const eventId = observation.observationId.slice(prefix.length).trim();
        if (eventId) {
            return eventId;
        }
    }
    return observation.observationId;
}

function isDuplicateObservationRejection(reason: string): boolean {
    return /was already processed/u.test(reason);
}

function createAgentExecutionLiveOptions(launch: AgentExecutionLaunch): {
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
} {
    return {
        ...(launch.protocolDescriptor ? { protocolDescriptor: launch.protocolDescriptor } : {}),
        ...(launch.transportState ? { transportState: launch.transportState } : {})
    };
}

function createDetachedAgentExecutionScope(owner: TerminalOwner | undefined): AgentExecutionScope {
    if (owner?.kind === 'agent-execution') {
        return { kind: 'system', label: owner.ownerId.trim() || 'detached' };
    }
    return { kind: 'system', label: 'detached' };
}

function createRunningSnapshot(input: {
    agentId: string;
    agentExecutionId: string;
    scope: AgentExecutionScope;
    workingDirectory: string;
    task?: AgentTaskContext;
    transport: NonNullable<AgentExecutionSnapshot['transport']>;
}): AgentExecutionSnapshot {
    return createTerminalSnapshot({
        ...input,
        status: 'running',
        progressState: 'working',
        acceptsPrompts: true,
        acceptedCommands: ['interrupt', 'checkpoint', 'nudge']
    });
}

function createProcessRunningSnapshot(input: {
    agentId: string;
    agentExecutionId: string;
    scope: AgentExecutionScope;
    workingDirectory: string;
    task?: AgentTaskContext;
}): AgentExecutionSnapshot {
    const timestamp = new Date().toISOString();
    const missionId = getAgentExecutionScopeMissionId(input.scope);
    const taskId = getAgentExecutionScopeTaskId(input.scope) ?? input.task?.taskId;
    const stageId = getAgentExecutionScopeStageId(input.scope) ?? input.task?.stageId;
    return {
        agentId: input.agentId,
        agentExecutionId: input.agentExecutionId,
        scope: input.scope,
        workingDirectory: input.workingDirectory,
        ...(taskId ? { taskId } : {}),
        ...(missionId ? { missionId } : {}),
        ...(stageId ? { stageId } : {}),
        status: 'running',
        attention: 'autonomous',
        progress: {
            state: 'working',
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: false,
        acceptedCommands: ['interrupt'],
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: 'running',
            acceptsPrompts: false,
            acceptedCommands: ['interrupt']
        }),
        reference: {
            agentId: input.agentId,
            agentExecutionId: input.agentExecutionId
        },
        startedAt: timestamp,
        updatedAt: timestamp
    };
}

function createTerminalSnapshot(input: {
    agentId: string;
    agentExecutionId: string;
    scope: AgentExecutionScope;
    workingDirectory: string;
    task?: AgentTaskContext;
    transport: NonNullable<AgentExecutionSnapshot['transport']>;
    status: AgentExecutionSnapshot['status'];
    progressState: AgentExecutionSnapshot['progress']['state'];
    acceptsPrompts: boolean;
    acceptedCommands: AgentCommand['type'][];
    failureMessage?: string;
    endedAt?: string;
}): AgentExecutionSnapshot {
    const timestamp = new Date().toISOString();
    const missionId = getAgentExecutionScopeMissionId(input.scope);
    const taskId = getAgentExecutionScopeTaskId(input.scope) ?? input.task?.taskId;
    const stageId = getAgentExecutionScopeStageId(input.scope) ?? input.task?.stageId;
    const reference: AgentExecutionReference = {
        agentId: input.agentId,
        agentExecutionId: input.agentExecutionId,
        transport: {
            kind: 'terminal',
            terminalName: input.transport.terminalName,
            ...(input.transport.terminalPaneId ? { terminalPaneId: input.transport.terminalPaneId } : {})
        }
    };
    return {
        agentId: input.agentId,
        agentExecutionId: input.agentExecutionId,
        scope: input.scope,
        workingDirectory: input.workingDirectory,
        ...(taskId ? { taskId } : {}),
        ...(missionId ? { missionId } : {}),
        ...(stageId ? { stageId } : {}),
        status: input.status,
        attention: input.status === 'running' ? 'autonomous' : 'none',
        progress: {
            state: input.progressState,
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: input.acceptsPrompts,
        acceptedCommands: [...input.acceptedCommands],
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: input.status,
            transport: input.transport,
            acceptsPrompts: input.acceptsPrompts,
            acceptedCommands: input.acceptedCommands
        }),
        transport: input.transport,
        reference,
        startedAt: timestamp,
        updatedAt: timestamp,
        ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
        ...(input.endedAt ? { endedAt: input.endedAt } : {})
    };
}

function createDetachedTerminalControllerSnapshot(
    agentId: string,
    reference: AgentExecutionReference,
    reason: string
): AgentExecutionSnapshot {
    const timestamp = new Date().toISOString();
    return {
        agentId,
        agentExecutionId: reference.agentExecutionId,
        scope: { kind: 'system', label: 'detached' },
        workingDirectory: 'unknown',
        status: 'terminated',
        attention: 'none',
        progress: {
            state: 'failed',
            detail: reason,
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: false,
        acceptedCommands: [],
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: 'terminated',
            ...(reference.transport ? { transport: { ...reference.transport } } : {}),
            acceptsPrompts: false,
            acceptedCommands: []
        }),
        reference: {
            agentId,
            agentExecutionId: reference.agentExecutionId,
            ...(reference.transport ? { transport: { ...reference.transport } } : {})
        },
        ...(reference.transport ? { transport: { ...reference.transport } } : {}),
        failureMessage: reason,
        startedAt: timestamp,
        updatedAt: timestamp,
        endedAt: timestamp
    };
}

function sendTerminalText(registry: TerminalRegistry, handle: TerminalHandle, text: string): void {
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.length > 0) {
            registry.sendKeys(handle.terminalName, line, { literal: true });
        }
        if (index < lines.length - 1 || normalized.length === 0 || line.length > 0) {
            registry.sendKeys(handle.terminalName, 'Enter');
        }
    }
}

async function waitForTerminalExit(
    registry: TerminalRegistry,
    handle: TerminalHandle,
    timeoutMs: number
): Promise<TerminalState> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let state = readTerminalState(registry, handle);
    while (!state.dead && Date.now() <= deadline) {
        await delay(50);
        state = readTerminalState(registry, handle);
    }
    return state;
}

function readTerminalState(registry: TerminalRegistry, handle: TerminalHandle): TerminalState {
    const snapshot: TerminalSnapshot | undefined = registry.readSnapshot(handle.terminalName);
    return snapshot
        ? { dead: snapshot.dead, exitCode: snapshot.exitCode }
        : { dead: true, exitCode: null };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTerminalCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
    switch (command.type) {
        case 'resume':
            return { source: 'system', text: command.reason?.trim() || 'Resume execution.' };
        case 'checkpoint':
            return {
                source: 'system',
                text: command.reason?.trim() || 'Provide a concise checkpoint, then continue with the task.'
            };
        case 'nudge':
            return { source: 'system', text: command.reason?.trim() || 'Continue with the assigned task.' };
    }
}

