import {
    AgentExecutionProtocolDescriptorSchema,
    type AgentSignalDeliveryType,
    type AgentSignalDescriptorType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType,
    type AgentExecutionInteractionPostureType
} from '../AgentExecutionCommunicationSchema.js';
import { defaultAgentExecutionMissionNativeCommandRegistry } from './AgentExecutionMissionNativeCommandRegistry.js';
import { baselineAgentSignalDescriptors } from '../observations/AgentExecutionObservationSignalRegistry.js';

export function createAgentExecutionProtocolDescriptor(input: {
    ownerId: string;
    ownerLabel?: string;
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
        owner: {
            ownerId: input.ownerId,
            ...(input.ownerLabel ? { label: input.ownerLabel } : {})
        },
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
