import type { AgentExecutionScope } from './AgentExecutionProtocolTypes.js';
import {
    AgentDeclaredSignalDescriptorSchema,
    AgentExecutionProtocolDescriptorSchema,
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
        payloadSchemaKey: 'agent-declared-signal.progress.v1',
        delivery: 'stdout-marker',
        policy: 'progress',
        outcomes: ['agent-execution-state', 'agent-execution-event']
    },
    {
        type: 'needs_input',
        label: 'Needs Input',
        description: 'Requests operator or owner input before the Agent execution can continue, with fixed choices or a manual input choice.',
        payloadSchemaKey: 'agent-declared-signal.needs-input.v1',
        delivery: 'stdout-marker',
        policy: 'input-request',
        outcomes: ['agent-execution-state', 'owner-entity-event']
    },
    {
        type: 'blocked',
        label: 'Blocked',
        description: 'Declares that the Agent execution is blocked on a specific condition.',
        payloadSchemaKey: 'agent-declared-signal.blocked.v1',
        delivery: 'stdout-marker',
        policy: 'claim',
        outcomes: ['agent-execution-state', 'owner-entity-event']
    },
    {
        type: 'ready_for_verification',
        label: 'Ready For Verification',
        description: 'Claims that the owner can begin verification.',
        payloadSchemaKey: 'agent-declared-signal.ready-for-verification.v1',
        delivery: 'stdout-marker',
        policy: 'claim',
        outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
    },
    {
        type: 'completed_claim',
        label: 'Completed Claim',
        description: 'Claims the scoped work is complete for owner evaluation.',
        payloadSchemaKey: 'agent-declared-signal.completed-claim.v1',
        delivery: 'stdout-marker',
        policy: 'claim',
        outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
    },
    {
        type: 'failed_claim',
        label: 'Failed Claim',
        description: 'Claims the scoped work failed for owner evaluation.',
        payloadSchemaKey: 'agent-declared-signal.failed-claim.v1',
        delivery: 'stdout-marker',
        policy: 'claim',
        outcomes: ['agent-execution-state', 'agent-execution-event', 'owner-entity-event']
    },
    {
        type: 'message',
        label: 'Message',
        description: 'Appends an audit-facing Agent execution message.',
        payloadSchemaKey: 'agent-declared-signal.message.v1',
        delivery: 'stdout-marker',
        policy: 'audit-message',
        outcomes: ['agent-execution-event']
    }
]);

export function createAgentExecutionProtocolDescriptor(input: {
    scope: AgentExecutionScope;
    messages: AgentExecutionMessageDescriptorType[];
    signals?: AgentDeclaredSignalDescriptorType[];
}): AgentExecutionProtocolDescriptorType {
    return AgentExecutionProtocolDescriptorSchema.parse({
        version: 1,
        owner: deriveAgentExecutionProtocolOwner(input.scope),
        scope: input.scope,
        messages: input.messages,
        signals: input.signals ?? baselineAgentDeclaredSignalDescriptors
    });
}


export function deriveAgentExecutionProtocolOwner(scope: AgentExecutionScope): AgentExecutionProtocolOwnerType {
    switch (scope.kind) {
        case 'system':
            return {
                entity: 'System',
                entityId: scope.label?.trim() || 'system',
                markerPrefix: 'system::'
            };
        case 'repository':
            return {
                entity: 'Repository',
                entityId: scope.repositoryRootPath,
                markerPrefix: 'repository::'
            };
        case 'mission':
            return {
                entity: 'Mission',
                entityId: scope.missionId,
                markerPrefix: 'mission::'
            };
        case 'task':
            return {
                entity: 'Task',
                entityId: scope.taskId,
                markerPrefix: 'task::'
            };
        case 'artifact':
            return {
                entity: 'Artifact',
                entityId: scope.artifactId,
                markerPrefix: 'artifact::'
            };
    }
}