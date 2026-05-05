import type { EntityContractType } from '../Entity/EntitySchema.js';
import type { EntityEventEnvelopeType } from '../Entity/EntitySchema.js';
import { AgentSession } from './AgentSession.js';
import { createEntityEventEnvelope, createEntityId } from '../Entity/Entity.js';
import {
    agentSessionEntityName,
    AgentSessionLocatorSchema,
    AgentSessionCommandInputSchema,
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
        },
        terminal: {
            payload: AgentSessionTerminalSnapshotSchema
        }
    }
};

export function createAgentSessionTerminalEvent(input: {
    missionId: string;
    sessionId: string;
    state: unknown;
}): EntityEventEnvelopeType {
    const missionId = input.missionId.trim();
    const sessionId = input.sessionId.trim();
    const payload = AgentSessionTerminalSnapshotSchema.parse({
        missionId,
        sessionId,
        ...(typeof input.state === 'object' && input.state !== null ? input.state : {})
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('agent_session', `${missionId}/${sessionId}`),
        eventName: 'terminal',
        type: 'session.terminal',
        missionId,
        payload
    });
}
