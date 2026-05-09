import type { AgentExecutionScope } from './AgentExecutionProtocolTypes.js';
import {
    AgentDeclaredSignalDescriptorSchema,
    AgentExecutionProtocolDescriptorSchema,
    type AgentDeclaredSignalDeliveryType,
    type AgentDeclaredSignalDescriptorType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionProtocolOwnerType
} from './AgentExecutionSchema.js';

export const baselineAgentDeclaredSignalDescriptors: AgentDeclaredSignalDescriptorType[] = AgentDeclaredSignalDescriptorSchema.array().parse([
    {
        type: 'progress',
        label: 'Progress',
        description: 'Reports current Agent execution progress for owner review.',
        icon: 'lucide:activity',
        tone: 'progress',
        payloadSchemaKey: 'agent-declared-signal.progress.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'progress',
        outcomes: ['agent-execution-state', 'agent-execution-event']
    },
    {
        type: 'status',
        label: 'Status',
        description: 'Reports a machine-readable Agent execution status phase such as initializing or idle.',
        icon: 'lucide:circle-dot',
        tone: 'neutral',
        payloadSchemaKey: 'agent-declared-signal.status.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'progress',
        outcomes: ['agent-execution-state', 'agent-execution-event']
    },
    {
        type: 'needs_input',
        label: 'Needs Input',
        description: 'Requests operator or owner input before the Agent execution can continue, with fixed choices or a manual input choice.',
        icon: 'lucide:message-circle-question',
        tone: 'attention',
        payloadSchemaKey: 'agent-declared-signal.needs-input.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'input-request',
        outcomes: ['agent-execution-state', 'owner-entity-event']
    },
    {
        type: 'blocked',
        label: 'Blocked',
        description: 'Declares that the Agent execution is blocked on a specific condition.',
        icon: 'lucide:octagon-alert',
        tone: 'danger',
        payloadSchemaKey: 'agent-declared-signal.blocked.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'claim',
        outcomes: ['agent-execution-state', 'owner-entity-event']
    },
    {
        type: 'ready_for_verification',
        label: 'Ready For Verification',
        description: 'Claims that the owner can begin verification.',
        icon: 'lucide:badge-check',
        tone: 'success',
        payloadSchemaKey: 'agent-declared-signal.ready-for-verification.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'claim',
        outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
    },
    {
        type: 'completed_claim',
        label: 'Completed Claim',
        description: 'Claims the scoped work is complete for owner evaluation.',
        icon: 'lucide:check-check',
        tone: 'success',
        payloadSchemaKey: 'agent-declared-signal.completed-claim.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'claim',
        outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
    },
    {
        type: 'failed_claim',
        label: 'Failed Claim',
        description: 'Claims the scoped work failed for owner evaluation.',
        icon: 'lucide:circle-x',
        tone: 'danger',
        payloadSchemaKey: 'agent-declared-signal.failed-claim.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'claim',
        outcomes: ['agent-execution-state', 'agent-execution-event', 'owner-entity-event']
    },
    {
        type: 'message',
        label: 'Message',
        description: 'Appends an audit-facing Agent execution message.',
        icon: 'lucide:message-square',
        tone: 'neutral',
        payloadSchemaKey: 'agent-declared-signal.message.v1',
        deliveries: ['stdout-marker', 'mcp-tool'],
        policy: 'audit-message',
        outcomes: ['agent-execution-event']
    }
]);

export function createAgentExecutionProtocolDescriptor(input: {
    scope: AgentExecutionScope;
    messages: AgentExecutionMessageDescriptorType[];
    signals?: AgentDeclaredSignalDescriptorType[];
    deliveries?: AgentDeclaredSignalDeliveryType[];
}): AgentExecutionProtocolDescriptorType {
    const signals = (input.signals ?? baselineAgentDeclaredSignalDescriptors).map((signal) => ({
        ...signal,
        deliveries: input.deliveries
            ? signal.deliveries.filter((delivery) => input.deliveries?.includes(delivery))
            : [...signal.deliveries],
        outcomes: [...signal.outcomes]
    })).filter((signal) => signal.deliveries.length > 0);
    return AgentExecutionProtocolDescriptorSchema.parse({
        version: 1,
        owner: deriveAgentExecutionProtocolOwner(input.scope),
        scope: input.scope,
        messages: input.messages,
        signals,
        ...(signals.some((signal) => signal.deliveries.includes('mcp-tool'))
            ? {
                mcp: {
                    serverName: 'mission-mcp',
                    exposure: 'session-scoped',
                    publicApi: false
                }
            }
            : {})
    });
}


export function deriveAgentExecutionProtocolOwner(scope: AgentExecutionScope): AgentExecutionProtocolOwnerType {
    switch (scope.kind) {
        case 'system':
            return {
                entity: 'System',
                entityId: scope.label?.trim() || 'system',
                markerPrefix: '@system::'
            };
        case 'repository':
            return {
                entity: 'Repository',
                entityId: scope.repositoryRootPath,
                markerPrefix: '@repository::'
            };
        case 'mission':
            return {
                entity: 'Mission',
                entityId: scope.missionId,
                markerPrefix: '@mission::'
            };
        case 'task':
            return {
                entity: 'Task',
                entityId: scope.taskId,
                markerPrefix: '@task::'
            };
        case 'artifact':
            return {
                entity: 'Artifact',
                entityId: scope.artifactId,
                markerPrefix: '@artifact::'
            };
    }
}