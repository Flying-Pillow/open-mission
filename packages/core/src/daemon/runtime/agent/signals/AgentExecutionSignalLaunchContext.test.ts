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
        expect(context.agentExecutionInstructions).toContain('Markers are cooperative protocol signals, not authoritative runtime facts.');
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
        expect(context.agentExecutionInstructions).toContain('Prefer Mission-owned MCP tools and access surfaces for replay-critical operations whenever possible.');
        expect(context.agentExecutionInstructions).toContain('When answering an operator/user question or providing a final operator-facing response, call the message tool with channel "agent" and put the canonical response in text as concise GitHub-flavored Markdown.');
        expect(context.agentExecutionInstructions).toContain('Do not duplicate final operator-facing responses in stdout, stderr, terminal prose, or provider-native chat text.');
        expect(context.agentExecutionInstructions).toContain('Use MCP tools for semantic AgentExecution material: canonical user-facing responses, status, progress, input requests, blockers, completion claims, and other Mission-owned semantic operations.');
        expect(context.agentExecutionInstructions).toContain('Treat passive stdout, stderr, and provider-specific payloads as auxiliary evidence rather than canonical replay truth.');
        expect(context.agentExecutionInstructions).toContain('Do not ask the operator for AgentExecution ids, event ids, tokens, or transport fields.');
        expect(context.agentExecutionInstructions).toContain('Omit eventId unless you are intentionally retrying the exact same signal.');
        expect(context.agentExecutionInstructions).not.toContain('Use normal prose for explanation; use tools only');
        expect(context.agentExecutionInstructions).not.toContain('@repository::');
        expect(context.agentExecutionInstructions).toContain('status: Status');
        expect(context.agentExecutionInstructions).toContain('needs_input: Needs Input');
        expect(context.agentExecutionInstructions).toContain('message: Message');
    });
});
