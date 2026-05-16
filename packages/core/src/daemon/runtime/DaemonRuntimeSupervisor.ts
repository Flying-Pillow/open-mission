import { TerminalRegistry } from '../../entities/Terminal/TerminalRegistry.js';
import type { AgentExecutionRuntimeSummary, AgentExecutionRegistry } from './agent-execution/AgentExecutionRegistry.js';
import type { OpenMissionMcpServer } from './agent-execution/mcp/OpenMissionMcpServer.js';
import type {
    DaemonRuntimeLease,
    DaemonRuntimeOwnerReference,
    DaemonRuntimeRelationship,
} from './DaemonRuntimeSupervisionSchema.js';
import type { DaemonRuntimeSupervisionSnapshot } from './DaemonRuntimeSupervisionSchema.js';

type ImpeccableLiveRegistryLike = {
    readRuntimeSnapshot(): DaemonRuntimeSupervisionSnapshot;
    dispose(): Promise<void>;
};

export type DaemonRuntimeSupervisorOptions = {
    daemonProcessId: number;
    startedAt: string;
    terminalRegistry: TerminalRegistry;
    agentExecutionRegistry?: AgentExecutionRegistry;
    openMissionMcpServer?: OpenMissionMcpServer;
    impeccableLiveRegistry?: ImpeccableLiveRegistryLike;
};

export class DaemonRuntimeSupervisor {
    private readonly daemonProcessId: number;
    private readonly startedAt: string;
    private readonly terminalRegistry: TerminalRegistry;
    private readonly agentExecutionRegistry: AgentExecutionRegistry | undefined;
    private readonly openMissionMcpServer: OpenMissionMcpServer | undefined;
    private readonly impeccableLiveRegistry: ImpeccableLiveRegistryLike | undefined;

    public constructor(options: DaemonRuntimeSupervisorOptions) {
        this.daemonProcessId = options.daemonProcessId;
        this.startedAt = options.startedAt;
        this.terminalRegistry = options.terminalRegistry;
        this.agentExecutionRegistry = options.agentExecutionRegistry;
        this.openMissionMcpServer = options.openMissionMcpServer;
        this.impeccableLiveRegistry = options.impeccableLiveRegistry;
    }

    public async start(): Promise<void> {
        await this.openMissionMcpServer?.start();
    }

    public readSnapshot(): DaemonRuntimeSupervisionSnapshot {
        const terminalSnapshot = this.terminalRegistry.readRuntimeSupervisionSnapshot({
            daemonProcessId: this.daemonProcessId,
            startedAt: this.startedAt
        });
        const baseSnapshot = this.impeccableLiveRegistry
            ? mergeRuntimeSnapshots(terminalSnapshot, this.impeccableLiveRegistry.readRuntimeSnapshot())
            : terminalSnapshot;
        const executionSummary = this.agentExecutionRegistry?.readRuntimeSummary();
        if (!executionSummary) {
            return baseSnapshot;
        }

        const owners = new Map(baseSnapshot.owners.map((owner) => [stableRuntimeReferenceKey(owner), owner]));
        const relationships: DaemonRuntimeRelationship[] = [...baseSnapshot.relationships];
        const leases = baseSnapshot.leases.map(cloneRuntimeLease);
        const leasesByOwnerKey = new Map<string, DaemonRuntimeLease>();
        for (const lease of leases) {
            if (lease.owner.kind === 'agent-execution') {
                leasesByOwnerKey.set(stableAgentExecutionOwnerKey(lease.owner.ownerId, lease.owner.agentExecutionId), lease);
            }
        }

        for (const execution of executionSummary.executions) {
            const executionOwner = toAgentExecutionOwnerReference(execution);
            owners.set(stableRuntimeReferenceKey(executionOwner), executionOwner);

            const lease = leasesByOwnerKey.get(stableAgentExecutionOwnerKey(execution.ownerId, execution.agentExecutionId));
            if (lease) {
                lease.metadata = {
                    ...(lease.metadata ?? {}),
                    runtimeHealth: execution.transportState?.health ?? (execution.attached ? 'attached' : 'detached'),
                    runtimeDegraded: execution.degraded,
                    runtimeAttached: execution.attached,
                    ...(execution.transportState?.reason ? { runtimeReason: execution.transportState.reason } : {}),
                    ...(execution.transportState?.commandable !== undefined ? { commandable: execution.transportState.commandable } : {}),
                    ...(execution.transportState?.signalCompatible !== undefined ? { signalCompatible: execution.transportState.signalCompatible } : {}),
                    ...(execution.transportState?.ownerMatched !== undefined ? { ownerMatched: execution.transportState.ownerMatched } : {}),
                    ...(execution.transportState?.leaseAttached !== undefined ? { leaseAttached: execution.transportState.leaseAttached } : {})
                };
            }
        }

        return {
            daemonProcessId: baseSnapshot.daemonProcessId,
            startedAt: baseSnapshot.startedAt,
            owners: [...owners.values()],
            relationships,
            leases
        };
    }

    public async releaseAll(): Promise<void> {
        await this.impeccableLiveRegistry?.dispose();
        await this.openMissionMcpServer?.stop();
        await this.terminalRegistry.dispose();
    }
}

function mergeRuntimeSnapshots(base: DaemonRuntimeSupervisionSnapshot, extension: DaemonRuntimeSupervisionSnapshot): DaemonRuntimeSupervisionSnapshot {
    const owners = new Map(base.owners.map((owner) => [stableRuntimeReferenceKey(owner), owner]));
    for (const owner of extension.owners) {
        owners.set(stableRuntimeReferenceKey(owner), owner);
    }

    const relationshipKeys = new Set<string>();
    const relationships: DaemonRuntimeRelationship[] = [];
    for (const relationship of [...base.relationships, ...extension.relationships]) {
        const key = `${stableRuntimeReferenceKey(relationship.parent)}>${stableGraphNodeReferenceKey(relationship.child)}>${relationship.relationship}`;
        if (relationshipKeys.has(key)) {
            continue;
        }
        relationshipKeys.add(key);
        relationships.push(relationship);
    }

    const leases = new Map<string, DaemonRuntimeLease>();
    for (const lease of [...base.leases, ...extension.leases]) {
        leases.set(lease.leaseId, lease);
    }

    return {
        daemonProcessId: base.daemonProcessId,
        startedAt: base.startedAt,
        owners: [...owners.values()],
        relationships,
        leases: [...leases.values()]
    };
}

function toAgentExecutionOwnerReference(entry: AgentExecutionRuntimeSummary['executions'][number]): DaemonRuntimeOwnerReference {
    return {
        kind: 'agent-execution',
        ownerId: entry.ownerId,
        agentExecutionId: entry.agentExecutionId,
    };
}

function stableRuntimeReferenceKey(reference: DaemonRuntimeOwnerReference): string {
    switch (reference.kind) {
        case 'system':
            return `system:${reference.label}`;
        case 'repository':
            return `repository:${reference.repositoryRootPath}`;
        case 'mission':
            return `mission:${reference.missionId}`;
        case 'task':
            return `task:${reference.missionId}:${reference.taskId}`;
        case 'agent-execution':
            return `agent-execution:${reference.ownerId}:${reference.agentExecutionId}`;
    }
}

function stableGraphNodeReferenceKey(reference: DaemonRuntimeRelationship['child']): string {
    if (reference.kind === 'runtime-lease') {
        return `runtime-lease:${reference.leaseId}`;
    }
    return stableRuntimeReferenceKey(reference);
}

function stableAgentExecutionOwnerKey(ownerId: string, agentExecutionId: string): string {
    return `${ownerId}\u0000${agentExecutionId}`;
}

function cloneRuntimeLease(lease: DaemonRuntimeLease): DaemonRuntimeLease {
    return {
        ...lease,
        owner: { ...lease.owner },
        ...(lease.metadata ? { metadata: { ...lease.metadata } } : {})
    };
}