import { createAgentExecutionProtocolDescriptor } from './AgentExecutionCommunicationDescriptor.js';
import {
    AgentExecutionMessageDescriptorSchema,
    type AgentExecutionInteractionCapabilitiesType,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionProtocolDescriptorType
} from '../AgentExecutionCommunicationSchema.js';
import {
    deriveAgentExecutionInteractionCapabilities,
    type AgentCommand,
    type AgentExecutionProcess,
    type AgentPrompt
} from '../AgentExecutionSchema.js';
import type { AgentExecutionType } from '../AgentExecutionSchema.js';

export function createAgentExecutionSupportedMessages(): AgentExecutionMessageDescriptorType[] {
    return createAgentExecutionSupportedMessagesForCommands(['interrupt', 'checkpoint', 'nudge', 'resume']);
}

export function createAgentExecutionSupportedMessagesForCommands(
    commandTypes: AgentCommand['type'][]
): AgentExecutionMessageDescriptorType[] {
    return AgentExecutionMessageDescriptorSchema.array().parse([
        { type: 'interrupt', label: 'Interrupt', icon: 'lucide:pause', tone: 'attention', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
        { type: 'checkpoint', label: 'Checkpoint', icon: 'lucide:milestone', tone: 'neutral', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
        { type: 'nudge', label: 'Nudge', icon: 'lucide:message-circle-more', tone: 'progress', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
        { type: 'resume', label: 'Resume', icon: 'lucide:play', tone: 'success', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' }
    ].filter((descriptor) => commandTypes.includes(descriptor.type as AgentCommand['type'])));
}

export function createAgentExecutionInteractionDescriptor(process: AgentExecutionProcess): AgentExecutionProtocolDescriptorType {
    return createAgentExecutionProtocolDescriptor({
        ownerId: process.ownerId,
        interactionPosture: process.interactionPosture,
        messages: resolveAgentExecutionSupportedMessages({
            lifecycleState: process.status,
            acceptsPrompts: process.acceptsPrompts,
            acceptedCommands: process.acceptedCommands
        })
    });
}

export function resolveAgentExecutionSupportedMessages(input: {
    lifecycleState: AgentExecutionType['lifecycleState'] | AgentExecutionProcess['status'];
    currentInputRequestId?: string | null;
    acceptsPrompts?: boolean;
    acceptedCommands?: AgentExecutionProcess['acceptedCommands'];
}): AgentExecutionMessageDescriptorType[] {
    const acceptedCommands = input.acceptedCommands ?? deriveAcceptedAgentExecutionCommands(input.lifecycleState, input.currentInputRequestId);
    return [
        ...createAgentExecutionSupportedMessagesForCommands(acceptedCommands),
        ...createNativeTerminalInputMessages(input.lifecycleState)
    ];
}

export function resolveAgentExecutionInputCapabilities(input: {
    lifecycleState: AgentExecutionType['lifecycleState'] | AgentExecutionProcess['status'];
    currentInputRequestId?: string | null;
    transport?: AgentExecutionProcess['transport'];
    acceptsPrompts?: boolean;
    acceptedCommands?: AgentExecutionProcess['acceptedCommands'];
}): AgentExecutionInteractionCapabilitiesType {
    return deriveAgentExecutionInteractionCapabilities({
        status: input.lifecycleState,
        ...(input.transport ? { transport: input.transport } : {}),
        acceptsPrompts: input.acceptsPrompts ?? acceptsAgentExecutionPrompts(input.lifecycleState, input.currentInputRequestId),
        acceptedCommands: input.acceptedCommands ?? deriveAcceptedAgentExecutionCommands(input.lifecycleState, input.currentInputRequestId)
    });
}

export function buildAgentExecutionCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
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

function createNativeTerminalInputMessages(
    lifecycleState: AgentExecutionType['lifecycleState'] | AgentExecutionProcess['status']
): AgentExecutionMessageDescriptorType[] {
    if (lifecycleState !== 'starting' && lifecycleState !== 'running') {
        return [];
    }
    return AgentExecutionMessageDescriptorSchema.array().parse([{
        type: 'model',
        label: 'Model',
        description: 'Open the running Agent session model selector.',
        icon: 'lucide:brain-circuit',
        delivery: 'best-effort',
        mutatesContext: false,
        portability: 'terminal-only'
    }]);
}

function acceptsAgentExecutionPrompts(
    lifecycleState: AgentExecutionType['lifecycleState'] | AgentExecutionProcess['status'],
    currentInputRequestId?: string | null
): boolean {
    return lifecycleState === 'running'
        || currentInputRequestId !== undefined && currentInputRequestId !== null;
}

function deriveAcceptedAgentExecutionCommands(
    lifecycleState: AgentExecutionType['lifecycleState'] | AgentExecutionProcess['status'],
    currentInputRequestId?: string | null
): AgentExecutionProcess['acceptedCommands'] {
    if (currentInputRequestId !== undefined && currentInputRequestId !== null) {
        return ['interrupt', 'checkpoint', 'nudge', 'resume'];
    }
    if (lifecycleState === 'starting' || lifecycleState === 'running') {
        return ['interrupt', 'checkpoint', 'nudge'];
    }
    return [];
}
