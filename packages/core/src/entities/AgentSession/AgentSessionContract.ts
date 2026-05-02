import type { EntityContractType } from '../Entity/EntitySchema.js';
import { AgentSession } from './AgentSession.js';
import {
    agentSessionEntityName,
    AgentSessionLocatorSchema,
    AgentSessionExecuteCommandInputSchema,
    AgentSessionSendPromptInputSchema,
    AgentSessionSendCommandInputSchema,
    AgentSessionSendTerminalInputSchema,
    AgentSessionStorageSchema,
    AgentSessionDataSchema,
    AgentSessionTerminalSnapshotSchema,
    AgentSessionCommandAcknowledgementSchema,
    AgentSessionSnapshotChangedEventSchema,
    AgentSessionEventSchema,
    AgentSessionLifecycleEventSchema
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
        executeCommand: {
            kind: 'mutation',
            payload: AgentSessionExecuteCommandInputSchema,
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
        'snapshot.changed': {
            payload: AgentSessionSnapshotChangedEventSchema
        },
        event: {
            payload: AgentSessionEventSchema
        },
        lifecycle: {
            payload: AgentSessionLifecycleEventSchema
        }
    }
};
