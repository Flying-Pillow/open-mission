import type { EntityContractType } from '../Entity/EntitySchema.js';
import { AgentSession } from './AgentSession.js';
import {
    agentSessionEntityName,
    agentSessionIdentityPayloadSchema,
    agentSessionExecuteCommandPayloadSchema,
    agentSessionSendPromptPayloadSchema,
    agentSessionSendCommandPayloadSchema,
    agentSessionReadTerminalPayloadSchema,
    agentSessionSendTerminalInputPayloadSchema,
    agentSessionSnapshotSchema,
    agentSessionTerminalSnapshotSchema,
    agentSessionCommandAcknowledgementSchema
} from './AgentSessionSchema.js';

export const agentSessionEntityContract: EntityContractType = {
    entity: agentSessionEntityName,
    entityClass: AgentSession,
    methods: {
        read: {
            kind: 'query',
            payload: agentSessionIdentityPayloadSchema,
            result: agentSessionSnapshotSchema,
            execution: 'class'
        },
        readTerminal: {
            kind: 'query',
            payload: agentSessionReadTerminalPayloadSchema,
            result: agentSessionTerminalSnapshotSchema,
            execution: 'class'
        },
        executeCommand: {
            kind: 'mutation',
            payload: agentSessionExecuteCommandPayloadSchema,
            result: agentSessionCommandAcknowledgementSchema,
            execution: 'class'
        },
        sendPrompt: {
            kind: 'mutation',
            payload: agentSessionSendPromptPayloadSchema,
            result: agentSessionCommandAcknowledgementSchema,
            execution: 'class'
        },
        sendCommand: {
            kind: 'mutation',
            payload: agentSessionSendCommandPayloadSchema,
            result: agentSessionCommandAcknowledgementSchema,
            execution: 'class'
        },
        sendTerminalInput: {
            kind: 'mutation',
            payload: agentSessionSendTerminalInputPayloadSchema,
            result: agentSessionTerminalSnapshotSchema,
            execution: 'class'
        }
    }
};
