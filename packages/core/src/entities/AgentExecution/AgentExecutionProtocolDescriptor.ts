import type { AgentExecutionScope } from './AgentExecutionProtocolTypes.js';
import {
    AgentExecutionProtocolDescriptorSchema,
    type AgentSignalDeliveryType,
    type AgentSignalDescriptorType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionProtocolOwnerType
} from './AgentExecutionSchema.js';
import { baselineAgentSignalDescriptors } from './AgentExecutionSignalRegistry.js';

export function createAgentExecutionProtocolDescriptor(input: {
    scope: AgentExecutionScope;
    messages: AgentExecutionMessageDescriptorType[];
    signals?: AgentSignalDescriptorType[];
    deliveries?: AgentSignalDeliveryType[];
}): AgentExecutionProtocolDescriptorType {
    const signals = (input.signals ?? baselineAgentSignalDescriptors).map((signal) => ({
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
                    exposure: 'agent-execution-scoped',
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