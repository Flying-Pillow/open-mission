import { describe, expect, it } from 'vitest';
import { buildAgentExecutionSignalLaunchContext } from './AgentExecutionSignalLaunchContext.js';
import { MISSION_PROTOCOL_MARKER_PREFIX } from './MissionProtocolMarkerParser.js';

describe('AgentExecutionSignalLaunchContext', () => {
    it('builds mandatory stdout marker instructions without transport env', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            missionId: 'mission-31',
            taskId: 'task-6',
            agentExecutionId: 'session-1'
        });

        expect(context.launchEnv).toEqual({});
        expect(context.sessionInstructions).toContain('Mission signal protocol is mandatory');
        expect(context.sessionInstructions).toContain(MISSION_PROTOCOL_MARKER_PREFIX);
        expect(context.sessionInstructions).toContain('missionId: mission-31');
        expect(context.sessionInstructions).toContain('taskId: task-6');
        expect(context.sessionInstructions).toContain('agentExecutionId: session-1');
        expect(context.sessionInstructions).toContain('"type":"progress"');
    });
});