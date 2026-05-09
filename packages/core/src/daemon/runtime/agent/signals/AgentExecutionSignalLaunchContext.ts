import type { AgentExecutionProtocolDescriptorType } from '../../../../entities/AgentExecution/AgentExecutionSchema.js';

export type AgentExecutionSignalLaunchContext = {
    launchEnv: Record<string, string>;
    sessionInstructions: string;
};

export function buildAgentExecutionSignalLaunchContext(input: {
    agentExecutionId: string;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
}): AgentExecutionSignalLaunchContext {
    if (input.protocolDescriptor.signals.some((signal) => signal.deliveries.includes('mcp-tool'))
        && !input.protocolDescriptor.signals.some((signal) => signal.deliveries.includes('stdout-marker'))) {
        return buildMcpToolLaunchContext(input);
    }

    const markerPrefix = input.protocolDescriptor.owner.markerPrefix;
    const markerExample = `${markerPrefix}${JSON.stringify({
        version: 1,
        agentExecutionId: input.agentExecutionId,
        eventId: 'replace-with-unique-event-id',
        signal: {
            type: 'progress',
            summary: 'Working on the next implementation step.'
        }
    })}`;
    const statusExample = `${markerPrefix}${JSON.stringify({
        version: 1,
        agentExecutionId: input.agentExecutionId,
        eventId: 'replace-with-unique-event-id',
        signal: {
            type: 'status',
            phase: 'idle',
            summary: 'The turn is complete and I am ready for the next structured prompt.'
        }
    })}`;
    const needsInputExample = `${markerPrefix}${JSON.stringify({
        version: 1,
        agentExecutionId: input.agentExecutionId,
        eventId: 'replace-with-unique-event-id',
        signal: {
            type: 'needs_input',
            question: 'Which verification path should I run next?',
            choices: [
                { kind: 'fixed', label: 'Run focused tests', value: 'focused-tests' },
                { kind: 'fixed', label: 'Run full package check', value: 'package-check' },
                { kind: 'manual', label: 'Other', placeholder: 'Describe the command or decision.' }
            ]
        }
    })}`;

    return {
        launchEnv: {},
        sessionInstructions: [
            'Structured status markers:',
            `- To report machine-readable status, print one stdout line that starts with ${markerPrefix} followed immediately by JSON.`,
            `- Every marker JSON must include agentExecutionId: ${input.agentExecutionId}.`,
            '- Use a fresh eventId for each marker.',
            '- Keep each marker on one line.',
            '- Use normal prose for explanation; use markers only for status, input requests, blockers, or completion claims.',
            '- Emit status with phase "initializing" when you start a turn and phase "idle" when the turn is complete but the session remains live.',
            '- Supported signal payloads:',
            ...input.protocolDescriptor.signals.map((signal) => `- ${signal.type}: ${signal.label} (${signal.policy})`),
            '- For status, use phase "initializing" or "idle" and include a concise summary when it helps the operator.',
            '- For needs_input, include a question and choices. Choices use kind "fixed" with label/value or kind "manual" with label and optional placeholder.',
            '- Example marker:',
            markerExample,
            '- Status marker example:',
            statusExample,
            '- Needs-input marker example:',
            needsInputExample
        ].join('\n')
    };
}


function buildMcpToolLaunchContext(input: {
    agentExecutionId: string;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
}): AgentExecutionSignalLaunchContext {
    const serverName = input.protocolDescriptor.mcp?.serverName ?? 'mission-mcp';
    return {
        launchEnv: {},
        sessionInstructions: [
            'Structured status tools:',
            `- Use the ${serverName} MCP tools to report machine-readable AgentExecution signals.`,
            '- Call the tool named for the signal you need to emit.',
            '- Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.',
            '- Provide only the signal payload fields requested by the tool, such as summary, question, choices, reason, channel, or text.',
            '- Omit eventId unless you are intentionally retrying the exact same signal.',
            '- Use normal prose for explanation; use tools only for status, input requests, blockers, or completion claims.',
            '- Emit status with phase "initializing" when you start a turn and phase "idle" when the turn is complete but the session remains live.',
            '- Supported signal tools:',
            ...input.protocolDescriptor.signals.map((signal) => `- ${signal.type}: ${signal.label} (${signal.policy})`),
            '- For status, use phase "initializing" or "idle" and include a concise summary when it helps the operator.',
            '- For needs_input, include a question and choices. Choices use kind "fixed" with label/value or kind "manual" with label and optional placeholder.'
        ].join('\n')
    };
}