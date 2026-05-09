import { describe, expect, it } from 'vitest';
import { buildAgentExecutionSignalLaunchContext } from './AgentExecutionSignalLaunchContext.js';
import { createAgentExecutionProtocolDescriptor } from '../../../../entities/AgentExecution/AgentExecutionProtocolDescriptor.js';

describe('AgentExecutionSignalLaunchContext', () => {
    it('builds mandatory stdout marker instructions without transport env', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'agent-execution-1',
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
        expect(context.agentExecutionInstructions).toContain('Structured status markers');
        expect(context.agentExecutionInstructions).toContain('@task::');
        expect(context.agentExecutionInstructions).not.toContain('missionId: mission-31');
        expect(context.agentExecutionInstructions).not.toContain('taskId: task-6');
        expect(context.agentExecutionInstructions).toContain('agentExecutionId: agent-execution-1');
        expect(context.agentExecutionInstructions).not.toContain('daemon');
        expect(context.agentExecutionInstructions).not.toContain('owning Entity');
        expect(context.agentExecutionInstructions).toContain('progress: Progress');
        expect(context.agentExecutionInstructions).toContain('status: Status');
        expect(context.agentExecutionInstructions).toContain('phase "idle"');
        expect(context.agentExecutionInstructions).toContain('For needs_input, include a question and choices');
        expect(context.agentExecutionInstructions).toContain('"kind":"fixed"');
        expect(context.agentExecutionInstructions).toContain('"kind":"manual"');
    });

    it('derives repository owner marker instructions from repository scope', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'repository-agent-execution-1',
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: '/repositories/Flying-Pillow/connect-four'
                },
                messages: []
            })
        });

        expect(context.agentExecutionInstructions).not.toContain("Repository '/repositories/Flying-Pillow/connect-four'");
        expect(context.agentExecutionInstructions).toContain('@repository::');
        expect(context.agentExecutionInstructions).toContain('agentExecutionId: repository-agent-execution-1');
    });

    it('builds MCP tool instructions without asking the Agent to choose event ids', () => {
        const context = buildAgentExecutionSignalLaunchContext({
            agentExecutionId: 'repository-agent-execution-1',
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
        expect(context.agentExecutionInstructions).toContain('Structured status tools');
        expect(context.agentExecutionInstructions).toContain('mission-mcp MCP tools');
        expect(context.agentExecutionInstructions).toContain('Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.');
        expect(context.agentExecutionInstructions).toContain('Omit eventId unless you are intentionally retrying the exact same signal.');
        expect(context.agentExecutionInstructions).not.toContain('@repository::');
        expect(context.agentExecutionInstructions).toContain('status: Status');
        expect(context.agentExecutionInstructions).toContain('needs_input: Needs Input');
    });
});
