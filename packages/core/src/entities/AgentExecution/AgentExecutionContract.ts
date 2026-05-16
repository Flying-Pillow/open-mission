import type { EntityContractType } from '../Entity/EntitySchema.js';
import { createEntityEventEnvelope, createEntityId } from '../Entity/Entity.js';
import type { EntityEventEnvelopeType } from '../Entity/EntitySchema.js';
import { AgentExecution } from './AgentExecution.js';
import {
    agentExecutionEntityName,
    AgentExecutionDataChangedEventSchema,
    AgentExecutionLocatorSchema,
    AgentExecutionSchema,
    AgentExecutionSendMessageAcknowledgementSchema,
    AgentExecutionSendMessageInputSchema,
    AgentExecutionStorageSchema,
    AgentExecutionTerminalSchema
} from './AgentExecutionSchema.js';

export const AgentExecutionContract: EntityContractType = {
    entity: agentExecutionEntityName,
    entityClass: AgentExecution,
    inputSchema: AgentExecutionLocatorSchema,
    storageSchema: AgentExecutionStorageSchema,
    dataSchema: AgentExecutionSchema,
    methods: {
        read: {
            kind: 'query',
            payload: AgentExecutionLocatorSchema,
            result: AgentExecutionSchema,
            execution: 'class'
        },
        sendMessage: {
            kind: 'mutation',
            payload: AgentExecutionSendMessageInputSchema,
            result: AgentExecutionSendMessageAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Send message',
                description: 'Accept a structured AgentExecution message for delivery through the execution message path.',
                tone: 'progress',
                presentationOrder: 100
            }
        }
    },
    events: {
        'data.changed': {
            payload: AgentExecutionDataChangedEventSchema
        }
    }
};

export function createAgentExecutionDataChangedEvent(input: {
    data: unknown;
}): EntityEventEnvelopeType {
    const data = AgentExecutionSchema.parse(input.data);
    return createEntityEventEnvelope({
        entityId: data.id,
        eventName: 'data.changed',
        type: 'agent_execution.data.changed',
        payload: AgentExecutionDataChangedEventSchema.parse({
            type: 'data.changed',
            data
        })
    });
}

export function createAgentExecutionTerminalEvent(input: {
    ownerId: string;
    agentExecutionId: string;
    state: unknown;
}): EntityEventEnvelopeType {
    const ownerId = input.ownerId.trim();
    const agentExecutionId = input.agentExecutionId.trim();
    const payload = AgentExecutionTerminalSchema.parse({
        reference: {
            entity: agentExecutionEntityName,
            ownerId,
            agentExecutionId
        },
        ...(typeof input.state === 'object' && input.state !== null ? input.state : {})
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('agent_execution', `${ownerId}/${agentExecutionId}`),
        eventName: 'terminal',
        type: 'agent_execution.terminal',
        payload
    });
}