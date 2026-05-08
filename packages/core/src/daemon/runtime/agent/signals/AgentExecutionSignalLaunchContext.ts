import type { AgentExecutionProtocolDescriptorType } from '../../../../entities/AgentExecution/AgentExecutionSchema.js';

export type AgentExecutionSignalLaunchContext = {
    launchEnv: Record<string, string>;
    sessionInstructions: string;
};

export function buildAgentExecutionSignalLaunchContext(input: {
    agentExecutionId: string;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
}): AgentExecutionSignalLaunchContext {
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
            '- Supported signal payloads:',
            ...input.protocolDescriptor.signals.map((signal) => `- ${signal.type}: ${signal.label} (${signal.policy})`),
            '- For needs_input, include a question and choices. Choices use kind "fixed" with label/value or kind "manual" with label and optional placeholder.',
            '- Example marker:',
            markerExample,
            '- Needs-input marker example:',
            needsInputExample
        ].join('\n')
    };
}