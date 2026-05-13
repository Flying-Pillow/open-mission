import { describe, expect, it } from 'vitest';
import { OpenMissionMcpServer } from './OpenMissionMcpServer.js';
import { createAgentExecutionProtocolDescriptor } from '../../../../entities/AgentExecution/AgentExecutionProtocolDescriptor.js';
import type { AgentExecutionObservation } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type { AgentExecutionObservationAckType } from '../../../../entities/AgentExecution/AgentExecutionSchema.js';
import type { AgentExecutionSemanticOperationResultType } from '../AgentExecutionSemanticOperations.js';

function createDescriptor() {
    return createAgentExecutionProtocolDescriptor({
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'task-1'
        },
        messages: []
    });
}

describe('OpenMissionMcpServer', () => {
    it('registers AgentExecution access and materializes descriptor-declared MCP tools', async () => {
        const observations: AgentExecutionObservation[] = [];
        const server = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation(input): AgentExecutionObservationAckType {
                    observations.push(input.observation);
                    return {
                        status: 'promoted',
                        agentExecutionId: input.agentExecutionId,
                        eventId: 'event-1',
                        observationId: input.observation.observationId
                    };
                }
            }
        });
        await server.start();

        const access = server.registerAccess({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            protocolDescriptor: createDescriptor()
        });

        expect(access.serverName).toBe('open-mission-mcp');
        expect(access.tools.map((tool) => tool.name)).toEqual([
            'read_artifact',
            'progress',
            'status',
            'needs_input',
            'blocked',
            'ready_for_verification',
            'completed_claim',
            'failed_claim',
            'message'
        ]);
        expect(server.listTools({ agentExecutionId: 'agent-execution-1', token: 'token-1' }).map((tool) => tool.name)).toEqual(access.tools.map((tool) => tool.name));

        const ack = await server.callTool({
            name: 'progress',
            input: {
                version: 1,
                agentExecutionId: 'agent-execution-1',
                eventId: 'event-1',
                token: 'token-1',
                signal: {
                    type: 'progress',
                    summary: 'Working through MCP.'
                }
            }
        });

        expect('status' in ack).toBe(true);
        if (!('status' in ack)) {
            throw new Error('Expected an observation acknowledgement result.');
        }
        expect(ack.status).toBe('promoted');
        expect(observations).toHaveLength(1);
        expect(observations[0]?.route.origin).toBe('agent-signal');
        expect(observations[0]?.route.address.agentExecutionId).toBe('agent-execution-1');
        expect(observations[0]?.signal).toMatchObject({
            type: 'progress',
            source: 'agent-signal',
            confidence: 'medium',
            summary: 'Working through MCP.'
        });
    });

    it('reads repository artifacts through Mission-owned MCP operations', async () => {
        const server = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation(): AgentExecutionObservationAckType {
                    throw new Error('unexpected route');
                },
                invokeSemanticOperation(input): AgentExecutionSemanticOperationResultType {
                    return {
                        operationName: 'read_artifact',
                        agentExecutionId: input.agentExecutionId,
                        eventId: input.input.eventId?.trim() || 'event-1',
                        path: input.input.path,
                        content: '# Brief\n',
                        factType: 'artifact-read'
                    };
                }
            }
        });
        await server.start();
        server.registerAccess({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            protocolDescriptor: createDescriptor()
        });

        const result = await server.callTool({
            name: 'read_artifact',
            input: {
                agentExecutionId: 'agent-execution-1',
                token: 'token-1',
                path: 'missions/1-initial-setup/BRIEF.md'
            }
        });

        expect(result).toMatchObject({
            operationName: 'read_artifact',
            agentExecutionId: 'agent-execution-1',
            path: 'missions/1-initial-setup/BRIEF.md',
            content: '# Brief\n',
            factType: 'artifact-read'
        });
    });

    it('rejects unauthorized and unsupported MCP tool calls before routing', async () => {
        const server = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation(): AgentExecutionObservationAckType {
                    throw new Error('unexpected route');
                }
            }
        });
        await server.start();
        server.registerAccess({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            protocolDescriptor: createDescriptor()
        });

        await expect(() => server.listTools({ agentExecutionId: 'agent-execution-1', token: 'wrong-token' })).toThrow('open-mission-mcp token');

        await expect(server.callTool({
            name: 'unsupported',
            input: {
                version: 1,
                agentExecutionId: 'agent-execution-1',
                eventId: 'event-1',
                token: 'token-1',
                signal: {
                    type: 'progress',
                    summary: 'No route.'
                }
            }
        })).resolves.toMatchObject({
            status: 'rejected',
            agentExecutionId: 'agent-execution-1',
            eventId: 'event-1'
        });

        await expect(server.callTool({
            name: 'progress',
            input: {
                version: 1,
                agentExecutionId: 'agent-execution-1',
                eventId: 'event-2',
                token: 'wrong-token',
                signal: {
                    type: 'progress',
                    summary: 'No route.'
                }
            }
        })).resolves.toMatchObject({
            status: 'rejected',
            agentExecutionId: 'agent-execution-1',
            eventId: 'event-2'
        });
    });

    it('accepts type-specific MCP tool input without nested signal discriminator or caller event id', async () => {
        const observations: AgentExecutionObservation[] = [];
        const server = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation(input): AgentExecutionObservationAckType {
                    observations.push(input.observation);
                    const eventId = input.observation.observationId.replace(/^agent-signal:/, '');
                    return {
                        status: 'promoted',
                        agentExecutionId: input.agentExecutionId,
                        eventId,
                        observationId: input.observation.observationId
                    };
                }
            }
        });
        await server.start();
        server.registerAccess({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            protocolDescriptor: createDescriptor()
        });

        const ack = await server.callTool({
            name: 'needs_input',
            input: {
                agentExecutionId: 'agent-execution-1',
                token: 'token-1',
                question: 'Should I set the repository-local Git author identity?',
                choices: [
                    { kind: 'fixed', label: 'Use authenticated GitHub account', value: 'use-authenticated-account' }
                ]
            }
        });

        expect('status' in ack).toBe(true);
        if (!('status' in ack)) {
            throw new Error('Expected an observation acknowledgement result.');
        }
        expect(ack.status).toBe('promoted');
        expect(ack.eventId).toMatch(/^mcp:needs_input:/);
        expect(observations[0]?.observationId).toBe(`agent-signal:${ack.eventId}`);
        expect(observations[0]?.signal).toMatchObject({
            type: 'needs_input',
            question: 'Should I set the repository-local Git author identity?',
            source: 'agent-signal',
            confidence: 'medium'
        });
    });

    it('rejects calls after stop', async () => {
        const server = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation(): AgentExecutionObservationAckType {
                    throw new Error('unexpected route');
                }
            }
        });
        await server.start();
        server.registerAccess({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            protocolDescriptor: createDescriptor()
        });
        await server.stop();

        expect(() => server.listTools({ agentExecutionId: 'agent-execution-1', token: 'token-1' })).toThrow('not started');
    });
});
