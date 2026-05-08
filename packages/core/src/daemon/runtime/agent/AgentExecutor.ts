import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
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
import { Repository } from '../../../entities/Repository/Repository.js';
import {
    TerminalRegistry,
    type SharedTerminalRegistryOptions,
    type TerminalHandle,
    type TerminalOwner,
    type TerminalSnapshot,
    type TerminalState
} from '../../../entities/Terminal/TerminalRegistry.js';
import type { AgentAdapter } from './AgentAdapter.js';
import { AgentExecutionObservationPolicy } from '../../../entities/AgentExecution/AgentExecutionObservationPolicy.js';
import { buildAgentExecutionSignalLaunchContext } from './signals/AgentExecutionSignalLaunchContext.js';
import { AgentExecutionObservationRouter } from './signals/AgentExecutionObservationRouter.js';
import type { AgentExecutionObservation } from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export type AgentExecutorOptions = {
    agentRegistry: AgentRegistry;
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
    parseAgentDeclaredSignals: boolean;
    observationPolicy: AgentExecutionObservationPolicy;
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
    sessionId?: string;
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
    private readonly observationRouter: AgentExecutionObservationRouter;
    private readonly managedExecutions = new Map<string, ManagedAgentExecution>();

    public constructor(options: AgentExecutorOptions) {
        this.agentRegistry = options.agentRegistry;
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

        const prepared = await this.prepareLaunch(config, adapter.id);
        const adapterPrepared = await adapter.prepareLaunchConfig(prepared.config);
        const launchPlan = adapter.createLaunchPlan(adapterPrepared.config);
        const runtimeController = launchPlan.mode === 'print'
            ? AgentExecutionProcessController.start({
                agentId: adapter.id,
                displayName: adapter.displayName,
                config: adapterPrepared.config,
                launch: {
                    sessionId: prepared.executionId,
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
                    sessionId: prepared.executionId,
                    command: launchPlan.command,
                    args: launchPlan.args,
                    skipInitialPromptSubmission: true,
                    ...(launchPlan.env ? { env: launchPlan.env } : {})
                }
            });
        const cleanup = adapterPrepared.cleanup;
        this.trackExecution({
            runtimeController,
            adapter,
            parseAgentDeclaredSignals: launchPlan.mode === 'print',
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
        this.trackExecution({ runtimeController, adapter, parseAgentDeclaredSignals: false });
        return runtimeController.execution;
    }

    public async submitPrompt(sessionId: string, prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(sessionId);
        return managed.runtimeController.submitPrompt(prompt);
    }

    public async submitCommand(sessionId: string, command: AgentCommand): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(sessionId);
        return managed.runtimeController.submitCommand(command);
    }

    public async completeExecution(sessionId: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(sessionId);
        return managed.runtimeController.complete();
    }

    public async cancelExecution(sessionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(sessionId);
        return managed.runtimeController.cancel(reason);
    }

    public async terminateExecution(sessionId: string, reason?: string): Promise<AgentExecutionSnapshot> {
        const managed = this.requireManagedExecution(sessionId);
        return managed.runtimeController.terminate(reason);
    }

    public getExecutionSnapshot(sessionId: string): AgentExecutionSnapshot | undefined {
        return this.managedExecutions.get(sessionId)?.execution.getSnapshot();
    }

    private async prepareLaunch(config: AgentLaunchConfig, agentId: string): Promise<{
        config: AgentLaunchConfig;
        executionId: string;
    }> {
        const executionId = AgentExecution.createFreshExecutionId(config, agentId);
        const protocolDescriptor = AgentExecution.createProtocolDescriptorForSnapshot({
            agentId,
            sessionId: executionId,
            scope: config.scope,
            workingDirectory: config.workingDirectory,
            ...(config.scope.kind === 'mission' ? { missionId: config.scope.missionId } : {}),
            ...(config.scope.kind === 'task' ? { missionId: config.scope.missionId, taskId: config.scope.taskId, stageId: config.scope.stageId } : {}),
            ...(config.scope.kind === 'artifact' ? { missionId: config.scope.missionId, taskId: config.scope.taskId, stageId: config.scope.stageId } : {}),
            status: 'starting',
            attention: 'autonomous',
            progress: {
                state: 'working',
                updatedAt: new Date().toISOString()
            },
            waitingForInput: false,
            acceptsPrompts: true,
            acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
            reference: {
                agentId,
                sessionId: executionId
            },
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        const launchContext = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: executionId,
            protocolDescriptor
        });
        return {
            executionId,
            config: {
                ...config,
                initialPrompt: config.initialPrompt
                    ? {
                        ...config.initialPrompt,
                        text: `${launchContext.sessionInstructions}\n\n${config.initialPrompt.text}`
                    }
                    : {
                        source: 'system',
                        text: launchContext.sessionInstructions
                    },
                launchEnv: {
                    ...(config.launchEnv ?? {}),
                    ...launchContext.launchEnv
                }
            }
        };
    }

    private trackExecution(input: {
        runtimeController: AgentExecutionRuntimeController;
        adapter: AgentAdapter;
        parseAgentDeclaredSignals: boolean;
        cleanup?: () => Promise<void>;
    }): void {
        const execution = input.runtimeController.execution;
        const sessionId = execution.getSnapshot().sessionId;
        this.disposeManagedExecution(sessionId);
        const eventSubscription = execution.onDidEvent((event) => this.handleExecutionEvent(sessionId, event));
        this.managedExecutions.set(sessionId, {
            execution,
            runtimeController: input.runtimeController,
            adapter: input.adapter,
            eventSubscription,
            outputLines: [],
            parseAgentDeclaredSignals: input.parseAgentDeclaredSignals,
            observationPolicy: new AgentExecutionObservationPolicy(),
            ...(input.cleanup ? { cleanup: input.cleanup } : {})
        });
    }

    private handleExecutionEvent(sessionId: string, event: AgentExecutionEvent): void {
        const managed = this.managedExecutions.get(sessionId);
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
                this.routeUsageObservation(managed, event.snapshot);
                this.disposeManagedExecution(sessionId);
                return;
            case 'execution.cancelled':
            case 'execution.terminated':
                this.disposeManagedExecution(sessionId);
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
            this.applyObservations(managed, observations);
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
            this.applyObservations(managed, this.observationRouter.route({
                kind: 'provider-output',
                observation,
                address: observationAddress,
                observedAt: snapshot.updatedAt
            }));
        }
        this.applyObservations(managed, this.observationRouter.route({
            kind: 'terminal-output',
            line,
            channel,
            address: observationAddress,
            markerPrefix,
            observedAt: snapshot.updatedAt
        }));
    }

    private routeUsageObservation(managed: ManagedAgentExecution, snapshot: AgentExecutionSnapshot): void {
        const observationAddress = toObservationAddress(snapshot);
        const usageObservation = managed.adapter.parseSessionUsageContent(managed.outputLines.join('\n'));
        if (!usageObservation) {
            return;
        }
        this.applyObservations(managed, this.observationRouter.route({
            kind: 'provider-output',
            observation: usageObservation,
            address: observationAddress,
            observedAt: snapshot.updatedAt
        }));
    }

    private applyObservations(managed: ManagedAgentExecution, observations: AgentExecutionObservation[]): void {
        for (const observation of observations) {
            const decision = managed.observationPolicy.evaluate({
                snapshot: managed.execution.getSnapshot(),
                observation
            });
            if (decision.action !== 'reject') {
                managed.execution.applySignalObservation(observation, decision);
            }
        }
    }

    private requireManagedExecution(sessionId: string): ManagedAgentExecution {
        const managed = this.managedExecutions.get(sessionId);
        if (!managed) {
            throw new Error(`AgentExecution '${sessionId}' is not managed by AgentExecutor.`);
        }
        return managed;
    }

    private disposeManagedExecution(sessionId: string): void {
        const managed = this.managedExecutions.get(sessionId);
        if (!managed) {
            return;
        }
        managed.eventSubscription.dispose();
        managed.runtimeController.dispose();
        this.managedExecutions.delete(sessionId);
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
        const sessionId = options.launch.sessionId?.trim() || AgentExecution.createFreshExecutionId(options.config, agentId);
        const execution = AgentExecution.createLive(createProcessRunningSnapshot({
            agentId,
            sessionId,
            scope: options.config.scope,
            workingDirectory: options.config.workingDirectory,
            ...(options.config.task ? { task: options.config.task } : {})
        }));
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
        throw new Error(`AgentExecution '${this.execution.sessionId}' is running in direct stdout mode and does not accept follow-up prompts.`);
    }

    public submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot> {
        if (command.type === 'interrupt') {
            return this.cancel(command.reason);
        }
        throw new Error(`AgentExecution '${this.execution.sessionId}' is running in direct stdout mode and only supports interruption.`);
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
        const sessionId = options.launch.sessionId?.trim() || AgentExecution.createFreshExecutionId(options.config, agentId);
        const terminalHandle = registry.openTerminal({
            workingDirectory: options.config.workingDirectory,
            command,
            args: options.launch.args ?? [],
            ...(options.launch.env ? { env: options.launch.env } : {}),
            terminalPrefix: options.launch.terminalPrefix?.trim() || options.terminalPrefix?.trim() || 'mission-agent',
            terminalName: buildAgentExecutionTerminalName(
                options.config.workingDirectory,
                options.config.scope,
                sessionId
            ),
            owner: toAgentExecutionTerminalOwner(options.config.scope, sessionId)
        });
        const execution = AgentExecution.createLive(createRunningSnapshot({
            agentId,
            sessionId,
            scope: options.config.scope,
            workingDirectory: options.config.workingDirectory,
            ...(options.config.task ? { task: options.config.task } : {}),
            transport: toSnapshotTransport(terminalHandle)
        }));
        const controller = new AgentExecutionTerminalController({ registry, execution, terminalHandle });

        if (!options.launch.skipInitialPromptSubmission && options.config.initialPrompt?.text) {
            void controller.submitPrompt(options.config.initialPrompt);
        }
        return controller;
    }

    public static reconcile(options: AgentExecutionTerminalReconcileOptions): AgentExecutionTerminalController {
        const agentId = options.agentId.trim();
        const registry = TerminalRegistry.shared(options);
        const terminalName = options.reference.transport?.terminalName ?? options.reference.sessionId;
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
                sessionId: options.reference.sessionId,
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
                sessionId: options.reference.sessionId,
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
            throw new Error(`Cannot ${action} for execution '${this.execution.sessionId}' because it is not backed by an active terminal.`);
        }
        return this.terminalHandle;
    }
}

function toObservationAddress(snapshot: AgentExecutionSnapshot): AgentExecutionObservationAddress {
    return {
        agentExecutionId: snapshot.sessionId,
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

function createDetachedAgentExecutionScope(owner: TerminalOwner | undefined): AgentExecutionScope {
    if (owner?.kind === 'agent-execution') {
        return { kind: 'system', label: owner.ownerId.trim() || 'detached' };
    }
    return { kind: 'system', label: 'detached' };
}

function createRunningSnapshot(input: {
    agentId: string;
    sessionId: string;
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
    sessionId: string;
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
        sessionId: input.sessionId,
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
            sessionId: input.sessionId
        },
        startedAt: timestamp,
        updatedAt: timestamp
    };
}

function createTerminalSnapshot(input: {
    agentId: string;
    sessionId: string;
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
        sessionId: input.sessionId,
        transport: {
            kind: 'terminal',
            terminalName: input.transport.terminalName,
            ...(input.transport.terminalPaneId ? { terminalPaneId: input.transport.terminalPaneId } : {})
        }
    };
    return {
        agentId: input.agentId,
        sessionId: input.sessionId,
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
        sessionId: reference.sessionId,
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
            sessionId: reference.sessionId,
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

