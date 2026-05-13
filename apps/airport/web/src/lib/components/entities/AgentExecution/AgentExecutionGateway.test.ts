import { describe, expect, it } from 'vitest';
import { AgentExecutionCommandIds } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityInvocation';
import { AgentExecutionGateway } from './AgentExecutionGateway.svelte.js';

describe('AgentExecutionGateway', () => {
    it('dispatches AgentExecution commands with the supplied owner id', async () => {
        const commandCalls: EntityCommandInvocation[] = [];
        const gateway = new AgentExecutionGateway({
            commandRemote: async (input) => {
                commandCalls.push(input);
                return createAgentExecutionAcknowledgement(input.payload as { ownerId: string; agentExecutionId: string; commandId: string });
            },
            queryRemote: async () => {
                throw new Error('Unexpected query.');
            }
        });

        await gateway.executeCommand({
            ownerId: '/repositories/Flying-Pillow/mission',
            agentExecutionId: 'repository-chat-1',
            commandId: AgentExecutionCommandIds.sendRuntimeMessage,
            input: {
                type: 'checkpoint',
                reason: 'before owner-neutral refactor'
            }
        });

        expect(commandCalls).toEqual([
            {
                entity: 'AgentExecution',
                method: 'command',
                payload: {
                    ownerId: '/repositories/Flying-Pillow/mission',
                    agentExecutionId: 'repository-chat-1',
                    commandId: AgentExecutionCommandIds.sendRuntimeMessage,
                    input: {
                        type: 'checkpoint',
                        reason: 'before owner-neutral refactor'
                    }
                }
            }
        ]);
    });

    it('creates browser AgentExecution dependencies without assuming Mission ownership', async () => {
        const commandCalls: EntityCommandInvocation[] = [];
        const queryCalls: EntityQueryInvocation[] = [];
        let mutationRefreshes = 0;
        const gateway = new AgentExecutionGateway({
            commandRemote: async (input) => {
                commandCalls.push(input);
                if (input.method === 'invokeSemanticOperation') {
                    return {
                        operationName: 'read_artifact',
                        agentExecutionId: 'system-agent-1',
                        eventId: 'event-1',
                        path: 'CONTEXT.md',
                        content: '# Context',
                        factType: 'artifact-read'
                    } satisfies EntityRemoteResult;
                }
                return createAgentExecutionAcknowledgement(input.payload as { ownerId: string; agentExecutionId: string; commandId: string });
            },
            queryRemote: async (input) => {
                queryCalls.push(input);
                return {
                    kind: 'prompt',
                    commandId: AgentExecutionCommandIds.sendPrompt,
                    input: {
                        source: 'operator',
                        text: 'hello'
                    }
                } satisfies EntityRemoteResult;
            }
        });
        const dependencies = gateway.createEntityDependencies({
            afterMutation: () => {
                mutationRefreshes += 1;
            }
        });

        await dependencies.resolveMessageShorthand('system', 'system-agent-1', 'hello');
        const result = await dependencies.invokeSemanticOperation('system', 'system-agent-1', {
            name: 'read_artifact',
            input: {
                path: 'CONTEXT.md'
            }
        });

        expect(queryCalls[0]).toMatchObject({
            entity: 'AgentExecution',
            method: 'resolveMessageShorthand',
            payload: {
                ownerId: 'system',
                agentExecutionId: 'system-agent-1',
                text: 'hello'
            }
        });
        expect(commandCalls[0]).toMatchObject({
            entity: 'AgentExecution',
            method: 'invokeSemanticOperation',
            payload: {
                ownerId: 'system',
                agentExecutionId: 'system-agent-1',
                name: 'read_artifact',
                input: {
                    path: 'CONTEXT.md'
                }
            }
        });
        expect(result).toMatchObject({
            operationName: 'read_artifact',
            agentExecutionId: 'system-agent-1'
        });
        expect(mutationRefreshes).toBe(1);
    });
});

function createAgentExecutionAcknowledgement(input: {
    ownerId: string;
    agentExecutionId: string;
    commandId: string;
}): EntityRemoteResult {
    return {
        ok: true,
        entity: 'AgentExecution',
        method: 'command',
        id: input.agentExecutionId,
        ownerId: input.ownerId,
        agentExecutionId: input.agentExecutionId,
        commandId: input.commandId
    };
}
