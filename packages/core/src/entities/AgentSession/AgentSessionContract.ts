import { z } from 'zod/v4';
import type { EntityContractType } from '../Entity/EntitySchema.js';
import { AgentSession } from './AgentSession.js';
import {
    agentSessionEntityName,
    AgentSessionLocatorSchema,
    AgentSessionExecuteCommandInputSchema,
    AgentSessionSendPromptInputSchema,
    AgentSessionSendCommandInputSchema,
    AgentSessionSendTerminalInputSchema,
    AgentSessionEventSubjectSchema,
    AgentSessionStorageSchema,
    AgentSessionDataSchema,
    AgentSessionTerminalSnapshotSchema,
    AgentSessionCommandAcknowledgementSchema
} from './AgentSessionSchema.js';

const AgentSessionSnapshotChangedEventSchema = z.object({
    reference: AgentSessionEventSubjectSchema,
    snapshot: AgentSessionDataSchema
}).strict();

const AgentSessionEventSchema = AgentSessionDataSchema;

const AgentSessionLifecycleEventSchema = z.object({
    phase: z.enum(['spawned', 'active', 'terminated']),
    lifecycleState: AgentSessionDataSchema.shape.lifecycleState
}).strict();

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
