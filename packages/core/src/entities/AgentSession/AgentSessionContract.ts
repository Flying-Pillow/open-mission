import type { EntityContractType } from '../Entity/EntitySchema.js';
import { AgentSession } from './AgentSession.js';
import {
    agentSessionEntityName,
    AgentSessionLocatorSchema,
    AgentSessionCommandInputSchema,
    AgentSessionSendPromptInputSchema,
    AgentSessionSendCommandInputSchema,
    AgentSessionSendTerminalInputSchema,
    AgentSessionStorageSchema,
    AgentSessionDataSchema,
    AgentSessionTerminalSnapshotSchema,
    AgentSessionCommandAcknowledgementSchema,
    AgentSessionDataChangedSchema
} from './AgentSessionSchema.js';

export const AgentSessionContract: EntityContractType = {
    entity: agentSessionEntityName,
    entityClass: AgentSession,
    inputSchema: AgentSessionLocatorSchema,
    storageSchema: AgentSessionStorageSchema,
    dataSchema: AgentSessionDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: AgentSessionLocatorSchema,
            result: AgentSessionDataSchema,
            execution: 'class'
        },
        readTerminal: {
            kind: 'query',
            payload: AgentSessionLocatorSchema,
            result: AgentSessionTerminalSnapshotSchema,
            execution: 'class'
        },
        command: {
            kind: 'mutation',
            payload: AgentSessionCommandInputSchema,
            result: AgentSessionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        sendPrompt: {
            kind: 'mutation',
            payload: AgentSessionSendPromptInputSchema,
            result: AgentSessionCommandAcknowledgementSchema,
            execution: 'class'
        },
        sendCommand: {
            kind: 'mutation',
            payload: AgentSessionSendCommandInputSchema,
            result: AgentSessionCommandAcknowledgementSchema,
            execution: 'class'
        },
        sendTerminalInput: {
            kind: 'mutation',
            payload: AgentSessionSendTerminalInputSchema,
            result: AgentSessionTerminalSnapshotSchema,
            execution: 'class'
        }
    },
    events: {
        'data.changed': {
            payload: AgentSessionDataChangedSchema
        }
    }
};
