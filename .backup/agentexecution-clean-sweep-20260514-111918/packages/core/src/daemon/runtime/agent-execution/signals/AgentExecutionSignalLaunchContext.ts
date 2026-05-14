import type { AgentExecutionProtocolDescriptorType } from '../../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecutionSignalMarkerPrefixSchema } from '../../../../entities/AgentExecution/AgentExecutionCommunicationSchema.js';

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

    const markerPrefix = AgentExecutionSignalMarkerPrefixSchema.value;
    const markerExample = `${markerPrefix}${JSON.stringify({
        version: 1,
        agentExecutionId: input.agentExecutionId,
        eventId: 'replace-with-unique-event-id',
        signal: {
            type: 'progress',
            summary: 'Working on the next implementation step.',
            artifacts: [{ path: 'apps/web/src/app.css', activity: 'edit' }]
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
            '- Markers are cooperative protocol signals, not authoritative Agent execution facts.',
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
    const availableTools = input.protocolDescriptor.signals.map((signal) => signal.type).join(', ');

    return {
        launchEnv: {},
        agentExecutionInstructions: [
            'Open Mission MCP is already connected and available.',
            'Open Mission MCP is the authoritative operator interaction protocol for this session.',

            'Do not start or configure MCP servers.',
            'Do not attempt to provision infrastructure for this session.',
            'Do not use provider-native approval UI, confirmation flows, terminal permission requests, or chat-native prompts for operator interaction.',
            'Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.',

            'Use:',
            '- progress for ongoing work updates.',
            '- status for initializing or idle state changes.',
            '- needs_input for approvals, clarification, permissions, or operator decisions.',
            '- blocked when work cannot continue.',
            '- ready_for_verification when work is ready for review.',
            '- completed_claim when requested work is complete.',
            '- failed_claim when requested work failed.',
            '- message for canonical operator-facing responses.',

            'If provider-native UI requests approval or confirmation, do not wait for provider-native interaction. Use needs_input instead.',

            'Use needs_input whenever:',
            '- a command requires approval.',
            '- a destructive action needs confirmation.',
            '- repository state is ambiguous.',
            '- sandbox restrictions block execution.',
            '- credentials or secrets are required.',
            '- multiple safe paths require operator choice.',
            '- the task cannot continue safely and autonomously.',

            'For needs_input, include a question and choices. Choices use kind "fixed" with label/value or kind "manual" with label and optional placeholder.',

            'When responding to the operator or providing a final operator-facing response, call the message tool with channel="agent" and provide concise GitHub-flavored Markdown.',

            'Do not duplicate canonical operator-facing responses in stdout, stderr, terminal prose, or provider-native chat text.',

            'When referring to tracked files, include artifacts with artifactId when known or a repository-relative path when available.',

            'Provide only the payload fields requested by the tool.',
            'Omit eventId unless intentionally retrying the exact same signal.',

            'Emit status with phase="initializing" when starting work.',
            'Emit status with phase="idle" when waiting for the next task while the AgentExecution remains live.',

            `Available tools: ${availableTools}.`
        ].join('\\n')
    };
}