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
        expect(context.sessionInstructions).toContain('Structured status markers');
        expect(context.sessionInstructions).toContain('@task::');
        expect(context.sessionInstructions).not.toContain('missionId: mission-31');
        expect(context.sessionInstructions).not.toContain('taskId: task-6');
        expect(context.sessionInstructions).toContain('agentExecutionId: session-1');
        expect(context.sessionInstructions).not.toContain('daemon');
        expect(context.sessionInstructions).not.toContain('owning Entity');
        expect(context.sessionInstructions).toContain('progress: Progress');
        expect(context.sessionInstructions).toContain('status: Status');
        expect(context.sessionInstructions).toContain('phase "idle"');
        expect(context.sessionInstructions).toContain('For needs_input, include a question and choices');
        expect(context.sessionInstructions).toContain('"kind":"fixed"');
        expect(context.sessionInstructions).toContain('"kind":"manual"');
    });

    it('derives repository owner marker instructions from repository scope', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'repository-session-1',
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: '/repositories/Flying-Pillow/connect-four'
                },
                messages: []
            })
        });

        expect(context.sessionInstructions).not.toContain("Repository '/repositories/Flying-Pillow/connect-four'");
        expect(context.sessionInstructions).toContain('@repository::');
        expect(context.sessionInstructions).toContain('agentExecutionId: repository-session-1');
    });

    it('builds MCP tool instructions without asking the Agent to choose event ids', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'repository-session-1',
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: '/repositories/Flying-Pillow/connect-four'
                },
                messages: [],
                deliveries: ['mcp-tool']
            })
        });

        expect(context.launchEnv).toEqual({});
        expect(context.sessionInstructions).toContain('Structured status tools');
        expect(context.sessionInstructions).toContain('mission-mcp MCP tools');
        expect(context.sessionInstructions).toContain('Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.');
        expect(context.sessionInstructions).toContain('Omit eventId unless you are intentionally retrying the exact same signal.');
        expect(context.sessionInstructions).not.toContain('@repository::');
        expect(context.sessionInstructions).toContain('status: Status');
        expect(context.sessionInstructions).toContain('needs_input: Needs Input');
    });
});
