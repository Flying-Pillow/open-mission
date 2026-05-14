import type { EntityContractType } from '../Entity/EntitySchema.js';
import { AgentExecution } from './AgentExecution.js';
import {
    agentExecutionEntityName,
    AgentExecutionDataChangedEventSchema,
    AgentExecutionLocatorSchema,
    AgentExecutionSchema,
    AgentExecutionSendMessageAcknowledgementSchema,
    AgentExecutionSendMessageInputSchema,
    AgentExecutionStorageSchema
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