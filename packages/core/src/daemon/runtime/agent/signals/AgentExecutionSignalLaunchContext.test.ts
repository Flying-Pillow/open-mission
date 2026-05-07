import { describe, expect, it } from 'vitest';
import { buildAgentExecutionSignalLaunchContext } from './AgentExecutionSignalLaunchContext.js';
import { createAgentExecutionProtocolDescriptor } from '../../../../entities/AgentExecution/AgentExecutionProtocolDescriptor.js';

describe('AgentExecutionSignalLaunchContext', () => {
    it('builds mandatory stdout marker instructions without transport env', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'session-1',
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'task',
                    missionId: 'mission-31',
                    taskId: 'task-6'
                },
                messages: []
            })
        });

        expect(context.launchEnv).toEqual({});
        expect(context.sessionInstructions).toContain('Agent execution structured interaction is mandatory');
        expect(context.sessionInstructions).toContain('task::');
        expect(context.sessionInstructions).not.toContain('missionId: mission-31');
        expect(context.sessionInstructions).not.toContain('taskId: task-6');
        expect(context.sessionInstructions).toContain('agentExecutionId: session-1');
        expect(context.sessionInstructions).toContain('wrong-execution markers');
        expect(context.sessionInstructions).toContain('progress: Progress');
        expect(context.sessionInstructions).toContain('needs_input with a question and choices');
        expect(context.sessionInstructions).toContain('"kind":"fixed"');
        expect(context.sessionInstructions).toContain('"kind":"manual"');
    });
});