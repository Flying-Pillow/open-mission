import type { AgentExecutionProtocolDescriptorType } from '../../../../entities/AgentExecution/AgentExecutionSchema.js';

export type AgentExecutionSignalLaunchContext = {
    launchEnv: Record<string, string>;
    agentExecutionInstructions: string;
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
            summary: 'Working on the next implementation step.',
            artifacts: [{ path: 'apps/airport/web/src/app.css', activity: 'edit' }]
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
        agentExecutionInstructions: [
            'Structured status markers:',
            `- To report machine-readable status, print one stdout line that starts with ${markerPrefix} followed immediately by JSON.`,
            `- Every marker JSON must include agentExecutionId: ${input.agentExecutionId}.`,
            '- Use a fresh eventId for each marker.',
            '- Keep each marker on one line.',
            '- Use normal prose for explanation; use markers only for status, input requests, blockers, or completion claims.',
            '- Markers are cooperative protocol signals, not authoritative runtime facts.',
            '- When a signal is about a specific tracked file, include artifacts with artifactId when known or a repository-relative path when that is what you have.',
            '- Emit status with phase "initializing" when you start a turn and phase "idle" when the turn is complete but the AgentExecution remains live.',
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
        agentExecutionInstructions: [
            'Structured status tools:',
            `- Use the ${serverName} MCP tools to report machine-readable AgentExecution signals.`,
            '- Prefer Mission-owned MCP tools and access surfaces for replay-critical operations whenever possible.',
            '- Use Mission-owned access for repository documents, workflow actions, verification, and structured operator communication instead of relying on opaque provider-native actions.',
            '- Call the tool named for the signal you need to emit.',
            '- Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.',
            '- Provide only the signal payload fields requested by the tool, such as summary, question, choices, reason, channel, or text.',
            '- When answering an operator/user question or providing a final operator-facing response, call the message tool with channel "agent" and put the canonical response in text as concise GitHub-flavored Markdown.',
            '- Do not duplicate final operator-facing responses in stdout, stderr, terminal prose, or provider-native chat text. Those streams are transport evidence and do not appear in AgentChat.',
            '- When the signal concerns a tracked file, include artifacts with artifactId when known or a repository-relative path when that is what you have.',
            '- Omit eventId unless you are intentionally retrying the exact same signal.',
            '- Use MCP tools for semantic AgentExecution material: canonical user-facing responses, status, progress, input requests, blockers, completion claims, and other Mission-owned semantic operations.',
            '- Treat passive stdout, stderr, and provider-specific payloads as auxiliary evidence rather than canonical replay truth.',
            '- Emit status with phase "initializing" when you start a turn and phase "idle" when the turn is complete but the AgentExecution remains live.',
            '- Supported signal tools:',
            ...input.protocolDescriptor.signals.map((signal) => `- ${signal.type}: ${signal.label} (${signal.policy})`),
            '- For status, use phase "initializing" or "idle" and include a concise summary when it helps the operator.',
            '- For needs_input, include a question and choices. Choices use kind "fixed" with label/value or kind "manual" with label and optional placeholder.'
        ].join('\n')
    };
}