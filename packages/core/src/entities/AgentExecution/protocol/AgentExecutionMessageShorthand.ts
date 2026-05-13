import {
    AgentExecutionCommandIds,
    AgentExecutionCommandSchema,
    AgentExecutionMessageShorthandResolutionSchema,
    type AgentExecutionMessageShorthandResolutionType,
    type AgentExecutionProtocolDescriptorType
} from './AgentExecutionProtocolSchema.js';
import { defaultAgentExecutionMissionNativeCommandRegistry } from './AgentExecutionMissionNativeCommandRegistry.js';

export type ResolveAgentExecutionMessageShorthandInput = {
    text: string;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
    terminalLane?: boolean;
};

export function resolveAgentExecutionMessageShorthand(input: ResolveAgentExecutionMessageShorthandInput): AgentExecutionMessageShorthandResolutionType {
    const rawText = input.text;
    const trimmedText = rawText.trim();
    if (!trimmedText.startsWith('/')) {
        return AgentExecutionMessageShorthandResolutionSchema.parse({
            kind: 'prompt',
            commandId: AgentExecutionCommandIds.sendPrompt,
            input: {
                source: 'operator',
                text: rawText
            }
        });
    }

    const commandText = trimmedText.slice(1).trim();
    const availableCommands = [...new Set([
        ...defaultAgentExecutionMissionNativeCommandRegistry.listCommandNames(),
        ...input.protocolDescriptor.messages.map((message) => message.type)
    ])];
    if (!commandText) {
        return createParseError('Agent message shorthand requires a command name after `/`.', undefined, availableCommands);
    }

    const [commandName = '', ...argumentParts] = commandText.split(/\s+/u);
    const argumentText = argumentParts.join(' ').trim();

    const missionNativeResolution = defaultAgentExecutionMissionNativeCommandRegistry.resolve({
        commandName,
        argumentText,
        availableCommands
    });
    if (missionNativeResolution) {
        return missionNativeResolution;
    }

    const descriptor = input.protocolDescriptor.messages.find((message) => message.type === commandName);

    if (!descriptor) {
        if (input.terminalLane) {
            return AgentExecutionMessageShorthandResolutionSchema.parse({
                kind: 'terminal-input',
                method: 'sendTerminalInput',
                input: {
                    data: rawText,
                    literal: true
                },
                reason: 'Command is not advertised by the AgentExecution protocol descriptor and was explicitly entered in the terminal lane.'
            });
        }
        return createParseError(`AgentExecution command '/${commandName}' is not advertised by the active protocol descriptor.`, commandName, availableCommands);
    }

    if (descriptor.portability === 'terminal-only') {
        if (!input.terminalLane) {
            return createParseError(`AgentExecution command '/${commandName}' is terminal-only and requires the terminal lane.`, commandName, availableCommands);
        }
        return AgentExecutionMessageShorthandResolutionSchema.parse({
            kind: 'terminal-input',
            method: 'sendTerminalInput',
            input: {
                data: rawText,
                literal: true
            },
            reason: 'Command is explicitly terminal-only in the AgentExecution protocol descriptor.'
        });
    }

    const commandInput = descriptor.portability === 'adapter-scoped'
        ? {
            type: descriptor.type,
            portability: 'adapter-scoped',
            ...(descriptor.adapterId ? { adapterId: descriptor.adapterId } : {}),
            ...(argumentText ? { reason: argumentText } : {})
        }
        : {
            type: descriptor.type,
            ...(argumentText ? { reason: argumentText } : {})
        };
    const command = AgentExecutionCommandSchema.safeParse(commandInput);
    if (!command.success) {
        return createParseError(`AgentExecution command '/${commandName}' is advertised but is not backed by a supported supported message schema yet.`, commandName, availableCommands);
    }

    return AgentExecutionMessageShorthandResolutionSchema.parse({
        kind: 'runtime-message',
        commandId: AgentExecutionCommandIds.sendRuntimeMessage,
        input: command.data,
        descriptor
    });
}

function createParseError(summary: string, commandName: string | undefined, availableCommands: string[]): AgentExecutionMessageShorthandResolutionType {
    return AgentExecutionMessageShorthandResolutionSchema.parse({
        kind: 'parse-error',
        summary,
        ...(commandName ? { commandName } : {}),
        availableCommands
    });
}