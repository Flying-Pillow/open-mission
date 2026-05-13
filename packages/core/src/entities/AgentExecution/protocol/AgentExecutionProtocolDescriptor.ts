import {
    AgentExecutionProtocolDescriptorSchema,
    type AgentExecutionScopeType,
    type AgentSignalDeliveryType,
    type AgentSignalDescriptorType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionProtocolOwnerType,
    type AgentExecutionInteractionPostureType
} from './AgentExecutionProtocolSchema.js';
import { defaultAgentExecutionMissionNativeCommandRegistry } from './AgentExecutionMissionNativeCommandRegistry.js';
import { baselineAgentSignalDescriptors } from './AgentExecutionSignalRegistry.js';

export function createAgentExecutionProtocolDescriptor(input: {
    scope: AgentExecutionScopeType;
    messages: AgentExecutionMessageDescriptorType[];
    signals?: AgentSignalDescriptorType[];
    deliveries?: AgentSignalDeliveryType[];
    interactionPosture?: AgentExecutionInteractionPostureType;
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
        interactionPosture: input.interactionPosture ?? 'structured-headless',
        messages: mergeProtocolMessages(
            defaultAgentExecutionMissionNativeCommandRegistry.listDescriptors(),
            input.messages
        ),
        signals,
        ...(signals.some((signal) => signal.deliveries.includes('mcp-tool'))
            ? {
                mcp: {
                    serverName: 'open-mission-mcp',
                    exposure: 'agent-execution-scoped',
                    publicApi: false
                }
            }
            : {})
    });
}

function mergeProtocolMessages(
    missionNativeMessages: AgentExecutionMessageDescriptorType[],
    supportedMessages: AgentExecutionMessageDescriptorType[]
): AgentExecutionMessageDescriptorType[] {
    const seenTypes = new Set<string>();
    return [...missionNativeMessages, ...supportedMessages].filter((message) => {
        if (seenTypes.has(message.type)) {
            return false;
        }
        seenTypes.add(message.type);
        return true;
    });
}


export function deriveAgentExecutionProtocolOwner(scope: AgentExecutionScopeType): AgentExecutionProtocolOwnerType {
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