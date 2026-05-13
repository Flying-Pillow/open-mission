import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    deriveAgentExecutionInteractionCapabilities,
    describeAgentExecutionScope,
    getAgentExecutionScopeMissionId,
    getAgentExecutionScopeStageId,
    getAgentExecutionScopeTaskId,
    type AgentCommand,
    type AgentExecutionReference,
    type AgentExecutionScope,
    type AgentExecutionSnapshot,
    type AgentPrompt,
    type AgentTaskContext
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { Repository } from '../../../entities/Repository/Repository.js';
import {
    TerminalRegistry,
    type TerminalHandle,
    type TerminalOwner,
    type TerminalSnapshot,
    type TerminalState
} from '../../../entities/Terminal/TerminalRegistry.js';
import type {
    AgentExecutionRuntimeController,
    AgentExecutionTerminalReconcileOptions,
    AgentExecutionTerminalStartOptions
} from './AgentExecutionRuntimeController.js';
import { createAgentExecutionLiveOptions } from './AgentExecutionRuntimeController.js';

export class AgentExecutionTerminalController implements AgentExecutionRuntimeController {
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
        }), {
            adapterLabel: displayName,
            ...createAgentExecutionLiveOptions(options.launch)
        });
        const controller = new AgentExecutionTerminalController({ registry, execution, terminalHandle });

        if (!options.launch.skipInitialPromptSubmission && options.config.initialPrompt?.text) {
            void controller.submitPrompt(options.config.initialPrompt);
        }
        return controller;
    }

    public static reconcile(options: AgentExecutionTerminalReconcileOptions): AgentExecutionTerminalController {
        const agentId = options.agentId.trim();
        const displayName = options.displayName.trim();
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
                ), { adapterLabel: displayName })
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
            execution: AgentExecution.createLive(snapshot, { adapterLabel: displayName }),
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
        interactionPosture: 'structured-interactive',
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
        interactionPosture: 'native-terminal-escape-hatch',
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
    if ('portability' in command && command.portability === 'adapter-scoped') {
        return {
            source: 'system',
            text: command.reason?.trim()
                ? `Run adapter-scoped command '${command.type}': ${command.reason.trim()}`
                : `Run adapter-scoped command '${command.type}'.`,
            metadata: {
                ...(command.metadata ?? {}),
                'mission.command.portability': 'adapter-scoped',
                'mission.command.adapterId': command.adapterId
            }
        };
    }
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
    throw new Error(`Unsupported AgentExecution command '${String((command as { type: string }).type)}'.`);
}