import type { EntityContractType } from '../Entity/EntitySchema.js';
import type { EntityEventEnvelopeType } from '../Entity/EntitySchema.js';
import { AgentExecution } from './AgentExecution.js';
import { createEntityEventEnvelope, createEntityId } from '../Entity/Entity.js';
import {
    agentExecutionEntityName,
    AgentExecutionLocatorSchema,
    AgentExecutionCommandInputSchema,
    AgentExecutionSendTerminalInputSchema
} from './AgentExecutionProtocolSchema.js';
import {
    AgentExecutionStorageSchema,
    AgentExecutionDataSchema,
    AgentExecutionCommandAcknowledgementSchema,
    AgentExecutionDataChangedSchema
} from './AgentExecutionDataSchema.js';
import { AgentExecutionTerminalSnapshotSchema } from './AgentExecutionTransportSchema.js';
import type { AgentExecutionDataType } from './AgentExecutionDataSchema.js';

export const AgentExecutionContract: EntityContractType = {
    entity: agentExecutionEntityName,
    entityClass: AgentExecution,
    inputSchema: AgentExecutionLocatorSchema,
    storageSchema: AgentExecutionStorageSchema,
    dataSchema: AgentExecutionDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: AgentExecutionLocatorSchema,
            result: AgentExecutionDataSchema,
            execution: 'class'
        },
        readTerminal: {
            kind: 'query',
            payload: AgentExecutionLocatorSchema,
            result: AgentExecutionTerminalSnapshotSchema,
            execution: 'class'
        },
        command: {
            kind: 'mutation',
            payload: AgentExecutionCommandInputSchema,
            result: AgentExecutionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        sendTerminalInput: {
            kind: 'mutation',
            payload: AgentExecutionSendTerminalInputSchema,
            result: AgentExecutionTerminalSnapshotSchema,
            execution: 'class'
        }
    },
    events: {
        'data.changed': {
            payload: AgentExecutionDataChangedSchema
        },
        terminal: {
            payload: AgentExecutionTerminalSnapshotSchema
        }
    }
};

export function createAgentExecutionTerminalEvent(input: {
    ownerId: string;
    agentExecutionId: string;
    state: unknown;
}): EntityEventEnvelopeType {
    const ownerId = input.ownerId.trim();
    const agentExecutionId = input.agentExecutionId.trim();
    const payload = AgentExecutionTerminalSnapshotSchema.parse({
        ownerId,
        agentExecutionId,
        ...(typeof input.state === 'object' && input.state !== null ? input.state : {})
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('agent_execution', `${ownerId}/${agentExecutionId}`),
        eventName: 'terminal',
        type: 'execution.terminal',
        payload
    });
}

export function createAgentExecutionDataChangedEvent(input: {
    data: AgentExecutionDataType;
}): EntityEventEnvelopeType {
    const data = AgentExecutionDataSchema.parse(input.data);
    const payload = AgentExecutionDataChangedSchema.parse({
        reference: {
            entity: agentExecutionEntityName,
            ownerId: data.ownerId,
            agentExecutionId: data.agentExecutionId
        },
        data
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('agent_execution', `${data.ownerId}/${data.agentExecutionId}`),
        eventName: 'data.changed',
        type: 'agentExecution.data.changed',
        payload
    });
}
