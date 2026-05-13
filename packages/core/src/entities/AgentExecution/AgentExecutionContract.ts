import type { EntityContractType } from '../Entity/EntitySchema.js';
import type { EntityEventEnvelopeType } from '../Entity/EntitySchema.js';
import { AgentExecution } from './AgentExecution.js';
import { createEntityEventEnvelope, createEntityId } from '../Entity/Entity.js';
import {
    agentExecutionEntityName,
    AgentExecutionLocatorSchema,
    AgentExecutionCommandInputSchema,
    AgentExecutionInvokeSemanticOperationInputSchema,
    AgentExecutionMessageShorthandResolutionSchema,
    AgentExecutionResolveMessageShorthandInputSchema,
    AgentExecutionSendTerminalInputSchema
} from './protocol/AgentExecutionProtocolSchema.js';
import { AgentExecutionSemanticOperationResultSchema } from './protocol/AgentExecutionSemanticOperationSchema.js';
import {
    AgentExecutionStorageSchema,
    AgentExecutionSchema,
    AgentExecutionCommandAcknowledgementSchema,
    AgentExecutionChangedSchema
} from './AgentExecutionSchema.js';
import { AgentExecutionTerminalSnapshotSchema } from './state/AgentExecutionTransportSchema.js';
import type { AgentExecutionType } from './AgentExecutionSchema.js';

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
        readTerminal: {
            kind: 'query',
            payload: AgentExecutionLocatorSchema,
            result: AgentExecutionTerminalSnapshotSchema,
            execution: 'class'
        },
        resolveMessageShorthand: {
            kind: 'query',
            payload: AgentExecutionResolveMessageShorthandInputSchema,
            result: AgentExecutionMessageShorthandResolutionSchema,
            execution: 'class',
            ui: {
                label: 'Resolve message shorthand',
                description: 'Resolve operator-facing slash shorthand into a structured AgentExecution invocation.',
                tone: 'neutral',
                presentationOrder: 90
            }
        },
        invokeSemanticOperation: {
            kind: 'mutation',
            payload: AgentExecutionInvokeSemanticOperationInputSchema,
            result: AgentExecutionSemanticOperationResultSchema,
            execution: 'class',
            ui: {
                label: 'Invoke semantic operation',
                description: 'Invoke a Mission-owned AgentExecution semantic operation for the live execution.',
                tone: 'neutral',
                presentationOrder: 95
            }
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
            payload: AgentExecutionChangedSchema
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
    data: AgentExecutionType;
}): EntityEventEnvelopeType {
    const execution = AgentExecutionSchema.parse(input.data);
    const payload = AgentExecutionChangedSchema.parse({
        reference: {
            entity: agentExecutionEntityName,
            ownerId: execution.ownerId,
            agentExecutionId: execution.agentExecutionId
        },
        execution
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('agent_execution', `${execution.ownerId}/${execution.agentExecutionId}`),
        eventName: 'data.changed',
        type: 'agentExecution.data.changed',
        payload
    });
}
