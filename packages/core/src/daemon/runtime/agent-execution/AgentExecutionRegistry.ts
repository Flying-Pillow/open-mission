import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    AgentExecutionSchema,
    type AgentExecutionLocatorType,
    type AgentExecutionSignalDecision,
    type AgentExecutionTerminalHandleType,
    type AgentExecutionType,
    type AgentLaunchConfig
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import {
    AgentRuntimeEventEmitter,
    type AgentRuntimeDisposable
} from './events.js';

export type AgentExecutionRuntimeType = AgentExecutionType & {
    taskId?: string;
    workingDirectory?: string;
    status: AgentExecutionType['lifecycle'];
    phase: string;
    lifecycleState: AgentExecutionType['lifecycle'];
    adapterLabel?: string;
    assignmentLabel?: string;
    currentTurnTitle?: string;
    transportId?: string;
    transport?: {
        kind: 'terminal';
        terminalName: string;
        terminalPaneId?: string;
    };
    terminalHandle?: AgentExecutionTerminalHandleType;
    awaitingInput?: boolean;
};

export type AgentExecutionRuntimeEventType =
    | {
        type: 'execution.started' | 'execution.attached' | 'execution.updated' | 'execution.completed' | 'execution.failed' | 'execution.cancelled' | 'execution.terminated';
        execution: AgentExecutionRuntimeType;
    }
    | {
        type: 'execution.message';
        execution: AgentExecutionRuntimeType;
        text: string;
        channel: 'stdout' | 'stderr' | 'system';
    };

export type AgentExecutionRuntimeSummary = {
    activeAgentExecutionCount: number;
    attachedAgentExecutionCount: number;
    detachedAgentExecutionCount: number;
    degradedAgentExecutionCount: number;
    protocolIncompatibleAgentExecutionCount: number;
    executionsWithoutRuntimeLeaseCount: number;
    executions: Array<{
        ownerId: string;
        agentExecutionId: string;
        attached: boolean;
        degraded: boolean;
        transportState?: {
            health?: 'attached' | 'detached';
            reason?: string;
            commandable?: boolean;
            signalCompatible?: boolean;
            ownerMatched?: boolean;
            leaseAttached?: boolean;
        };
    }>;
};

export type AgentExecutionRegistry = ReturnType<typeof createAgentExecutionRegistry>;

type StoredExecution = {
    ownerKey: string;
    execution: ManagedAgentExecution;
    subscription: AgentRuntimeDisposable;
};

export class ManagedAgentExecution {
    private readonly eventEmitter = new AgentRuntimeEventEmitter<AgentExecutionRuntimeEventType>();
    private snapshot: AgentExecutionRuntimeType;

    public constructor(
        private readonly execution: AgentExecution,
        initialRuntime: Partial<AgentExecutionRuntimeType> = {}
    ) {
        this.snapshot = ManagedAgentExecution.buildRuntimeSnapshot(execution.toEntity(), initialRuntime);
    }

    public get agentExecutionId(): string {
        return this.execution.agentExecutionId;
    }

    public toEntity(): AgentExecutionType {
        return this.execution.toEntity();
    }

    public getSnapshot(): AgentExecutionRuntimeType {
        return structuredClone(this.snapshot);
    }

    public onDidEvent(listener: (event: AgentExecutionRuntimeEventType) => void): AgentRuntimeDisposable {
        return this.eventEmitter.event(listener);
    }

    public applySignalDecision(
        decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
    ): AgentExecutionRuntimeType {
        return this.publishRuntimeUpdate({ awaitingInput: decision.action === 'pause' }, 'execution.updated');
    }

    public emitMessage(text: string, channel: 'stdout' | 'stderr' | 'system' = 'stdout'): void {
        this.eventEmitter.fire({
            type: 'execution.message',
            execution: this.getSnapshot(),
            text,
            channel
        });
    }

    public emitAwaitingInput(): AgentExecutionRuntimeType {
        return this.publishRuntimeUpdate({ awaitingInput: true }, 'execution.updated');
    }

    public setLifecycleState(
        lifecycle: AgentExecutionType['lifecycle'],
        eventType:
            | 'execution.started'
            | 'execution.attached'
            | 'execution.updated'
            | 'execution.completed'
            | 'execution.failed'
            | 'execution.cancelled'
            | 'execution.terminated' = 'execution.updated'
    ): AgentExecutionRuntimeType {
        this.execution.updateFromData(AgentExecutionSchema.parse({
            ...this.execution.toEntity(),
            lifecycle,
            updatedAt: new Date().toISOString()
        }));
        return this.publishRuntimeUpdate({
            status: lifecycle,
            lifecycleState: lifecycle,
            phase: lifecycle
        }, eventType);
    }

    public attachRuntimeContext(input: {
        taskId?: string;
        adapterLabel?: string;
        assignmentLabel?: string;
        currentTurnTitle?: string;
        terminalHandle?: AgentExecutionTerminalHandleType;
        transport?: AgentExecutionRuntimeType['transport'];
        transportId?: string;
        workingDirectory?: string;
        phase?: string;
        awaitingInput?: boolean;
    }): AgentExecutionRuntimeType {
        return this.publishRuntimeUpdate({
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.adapterLabel ? { adapterLabel: input.adapterLabel } : {}),
            ...(input.assignmentLabel ? { assignmentLabel: input.assignmentLabel } : {}),
            ...(input.currentTurnTitle ? { currentTurnTitle: input.currentTurnTitle } : {}),
            ...(input.terminalHandle ? { terminalHandle: input.terminalHandle } : {}),
            ...(input.transport ? { transport: input.transport } : {}),
            ...(input.transportId ? { transportId: input.transportId } : {}),
            ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
            ...(input.phase ? { phase: input.phase } : {}),
            ...(input.awaitingInput !== undefined ? { awaitingInput: input.awaitingInput } : {})
        });
    }

    private publishRuntimeUpdate(
        overrides: Partial<AgentExecutionRuntimeType>,
        eventType?: Extract<AgentExecutionRuntimeEventType['type'], 'execution.started' | 'execution.attached' | 'execution.updated' | 'execution.completed' | 'execution.failed' | 'execution.cancelled' | 'execution.terminated'>
    ): AgentExecutionRuntimeType {
        this.snapshot = ManagedAgentExecution.buildRuntimeSnapshot(this.execution.toEntity(), {
            ...this.snapshot,
            ...overrides
        });
        const snapshot = this.getSnapshot();
        if (eventType) {
            this.eventEmitter.fire({
                type: eventType,
                execution: snapshot
            });
        }
        return snapshot;
    }

    private static buildRuntimeSnapshot(
        canonical: AgentExecutionType,
        candidate: Partial<AgentExecutionRuntimeType>
    ): AgentExecutionRuntimeType {
        return {
            ...canonical,
            ...(candidate.taskId ? { taskId: candidate.taskId } : {}),
            ...(candidate.workingDirectory ? { workingDirectory: candidate.workingDirectory } : {}),
            status: candidate.status ?? candidate.lifecycleState ?? canonical.lifecycle,
            phase: candidate.phase ?? candidate.status ?? candidate.lifecycleState ?? canonical.lifecycle,
            lifecycleState: candidate.lifecycleState ?? candidate.status ?? canonical.lifecycle,
            ...(candidate.adapterLabel ? { adapterLabel: candidate.adapterLabel } : {}),
            ...(candidate.assignmentLabel ? { assignmentLabel: candidate.assignmentLabel } : {}),
            ...(candidate.currentTurnTitle ? { currentTurnTitle: candidate.currentTurnTitle } : {}),
            ...(candidate.transportId ? { transportId: candidate.transportId } : {}),
            ...(candidate.transport ? { transport: candidate.transport } : {}),
            ...(candidate.terminalHandle ? { terminalHandle: candidate.terminalHandle } : {}),
            ...(candidate.awaitingInput !== undefined ? { awaitingInput: candidate.awaitingInput } : {})
        };
    }
}

function createAgentExecutionRegistry() {
    const executionsById = new Map<string, StoredExecution>();
    const listeners = new Set<(data: AgentExecutionRuntimeType) => void>();

    const notify = (snapshot: AgentExecutionRuntimeType) => {
        for (const listener of listeners) {
            listener(snapshot);
        }
    };

    const storeExecution = (ownerKey: string, execution: ManagedAgentExecution): AgentExecutionRuntimeType => {
        const existing = executionsById.get(execution.agentExecutionId);
        existing?.subscription.dispose();

        const subscription = execution.onDidEvent((event) => {
            if (event.type !== 'execution.message') {
                notify(event.execution);
            }
        });

        executionsById.set(execution.agentExecutionId, { ownerKey, execution, subscription });
        const snapshot = execution.getSnapshot();
        notify(snapshot);
        return snapshot;
    };

    const deleteStoredExecution = (agentExecutionId: string): void => {
        const existing = executionsById.get(agentExecutionId);
        existing?.subscription.dispose();
        executionsById.delete(agentExecutionId);
    };

    return {
        configure(_options: { openMissionMcpServer?: unknown } = {}): void { },
        dispose(): void {
            for (const execution of executionsById.values()) {
                execution.subscription.dispose();
            }
            executionsById.clear();
            listeners.clear();
        },
        onDidExecutionDataChange(listener: (data: AgentExecutionRuntimeType) => void): AgentRuntimeDisposable {
            listeners.add(listener);
            return {
                dispose: () => {
                    listeners.delete(listener);
                }
            };
        },
        async ensureExecution(input: {
            ownerKey: string;
            agentRegistry: AgentRegistry;
            config: AgentLaunchConfig;
        }): Promise<AgentExecutionRuntimeType> {
            const agentId = input.config.requestedAdapterId ?? input.config.agentId ?? input.agentRegistry.resolveStartAgentId();
            if (!agentId) {
                throw new Error('AgentExecutionRegistry requires a resolvable agent adapter id.');
            }
            const execution = await input.agentRegistry.requireAgentAdapter(agentId).startExecution(input.config);
            return storeExecution(input.ownerKey, execution);
        },
        async replaceActiveExecution(input: {
            ownerKey: string;
            agentRegistry: AgentRegistry;
            config: AgentLaunchConfig;
        }): Promise<AgentExecutionRuntimeType> {
            const existing = [...executionsById.values()].find((entry) => entry.ownerKey === input.ownerKey);
            if (existing) {
                deleteStoredExecution(existing.execution.agentExecutionId);
            }
            return this.ensureExecution(input);
        },
        getManagedExecution(agentExecutionId: string): ManagedAgentExecution | undefined {
            return executionsById.get(agentExecutionId)?.execution;
        },
        readReusableExecution(input: { ownerKey: string; requestedAgentId?: string }): AgentExecutionRuntimeType | undefined {
            const existing = [...executionsById.values()].find((entry) => entry.ownerKey === input.ownerKey);
            if (!existing) {
                return undefined;
            }
            const snapshot = existing.execution.getSnapshot();
            if (input.requestedAgentId && snapshot.agentId !== input.requestedAgentId) {
                return undefined;
            }
            if (['completed', 'failed', 'cancelled', 'terminated'].includes(snapshot.status)) {
                return undefined;
            }
            return snapshot;
        },
        resolve(locator: AgentExecutionLocatorType): AgentExecutionType | undefined {
            if (locator.id) {
                return [...executionsById.values()].find((entry) => entry.execution.toEntity().id === locator.id)?.execution.toEntity();
            }
            return [...executionsById.values()].find((entry) => {
                const execution = entry.execution.toEntity();
                return execution.ownerEntity === locator.ownerEntity
                    && execution.ownerId === locator.ownerId
                    && execution.agentExecutionId === locator.agentExecutionId;
            })?.execution.toEntity();
        },
        read(locator: AgentExecutionLocatorType): AgentExecutionType | undefined {
            return this.resolve(locator);
        },
        readRuntimeSummary(): AgentExecutionRuntimeSummary {
            const executions = [...executionsById.values()].map(({ execution }) => {
                const snapshot = execution.getSnapshot();
                return ({
                ownerId: snapshot.ownerId,
                agentExecutionId: snapshot.agentExecutionId,
                attached: snapshot.transport?.kind === 'terminal',
                degraded: false,
                transportState: {
                    health: snapshot.transport?.kind === 'terminal'
                        ? ('attached' as const)
                        : ('detached' as const),
                    commandable: true,
                    signalCompatible: true,
                    ownerMatched: true,
                    leaseAttached: snapshot.transport?.kind === 'terminal'
                }
                });
            });
            return {
                activeAgentExecutionCount: executions.length,
                attachedAgentExecutionCount: executions.filter((execution) => execution.attached).length,
                detachedAgentExecutionCount: executions.filter((execution) => !execution.attached).length,
                degradedAgentExecutionCount: 0,
                protocolIncompatibleAgentExecutionCount: 0,
                executionsWithoutRuntimeLeaseCount: 0,
                executions
            };
        }
    };
}

let defaultRegistry: AgentExecutionRegistry | undefined;

export function getDefaultAgentExecutionRegistry(_options: { logger?: unknown } = {}): AgentExecutionRegistry {
    defaultRegistry ??= createAgentExecutionRegistry();
    return defaultRegistry;
}