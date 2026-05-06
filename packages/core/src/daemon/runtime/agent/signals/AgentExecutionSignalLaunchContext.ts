import { MISSION_PROTOCOL_MARKER_PREFIX } from './MissionProtocolMarkerParser.js';

export type AgentExecutionSignalLaunchContext = {
    launchEnv: Record<string, string>;
    sessionInstructions: string;
};

export function buildAgentExecutionSignalLaunchContext(input: {
    missionId: string;
    taskId: string;
    agentExecutionId: string;
}): AgentExecutionSignalLaunchContext {
    const markerExample = `${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
        version: 1,
        missionId: input.missionId,
        taskId: input.taskId,
        agentExecutionId: input.agentExecutionId,
        eventId: 'replace-with-unique-event-id',
        signal: {
            type: 'progress',
            summary: 'Working on the next implementation step.'
        }
    })}`;

    return {
        launchEnv: {},
        sessionInstructions: [
            'Mission signal protocol is mandatory for this Agent execution.',
            '- Mission observes your stdout and parses strict one-line signal markers deterministically.',
            `- Every structured state signal must start at the beginning of a stdout line with ${MISSION_PROTOCOL_MARKER_PREFIX} followed immediately by strict JSON.`,
            '- Do not use prose as a substitute for structured state signals; prose is only explanatory output.',
            '- Use a fresh eventId for every distinct signal. Reusing an eventId is treated as a duplicate.',
            '- Keep every marker on one line. Malformed, oversized, stderr, or wrong-scope markers are rejected or recorded only as diagnostics.',
            '- Completion and ready-for-verification markers are claims, not deterministic verification authority.',
            'Use these exact scope fields in every marker:',
            `- missionId: ${input.missionId}`,
            `- taskId: ${input.taskId}`,
            `- agentExecutionId: ${input.agentExecutionId}`,
            'Supported signal payloads:',
            '- {"type":"progress","summary":"...","detail":"..."}',
            '- {"type":"needs_input","question":"...","suggestedResponses":["..."]}',
            '- {"type":"blocked","reason":"..."}',
            '- {"type":"ready_for_verification","summary":"..."}',
            '- {"type":"completed_claim","summary":"..."}',
            '- {"type":"failed_claim","reason":"..."}',
            '- {"type":"message","channel":"agent","text":"..."}',
            'Example marker:',
            markerExample
        ].join('\n')
    };
}