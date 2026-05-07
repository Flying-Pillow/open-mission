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
            'Agent execution structured interaction is mandatory for this execution.',
            `- The owning Entity is ${input.protocolDescriptor.owner.entity} '${input.protocolDescriptor.owner.entityId}'.`,
            '- Mission observes your stdout and parses strict one-line owner-addressed signal markers deterministically.',
            `- Every structured state signal must start at the beginning of a stdout line with ${markerPrefix} followed immediately by strict JSON.`,
            '- Do not use prose as a substitute for structured state signals; prose is only explanatory output.',
            '- Use a fresh eventId for every distinct signal. Reusing an eventId is treated as a duplicate.',
            '- Keep every marker on one line. Malformed, oversized, stderr, or wrong-execution markers are rejected or recorded only as diagnostics.',
            '- Completion and ready-for-verification markers are claims, not deterministic verification authority.',
            'Use this exact execution field in every marker:',
            `- agentExecutionId: ${input.agentExecutionId}`,
            'Supported signal payloads:',
            ...input.protocolDescriptor.signals.map((signal) => `- ${signal.type}: ${signal.label} (${signal.policy})`),
            'When requesting input, emit needs_input with a question and choices. Use kind "fixed" for selectable choices with label/value, and kind "manual" for freeform operator input with label and optional placeholder.',
            'Example marker:',
            markerExample,
            'Needs-input marker example:',
            needsInputExample
        ].join('\n')
    };
}