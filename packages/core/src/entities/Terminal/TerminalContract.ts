import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Terminal } from './Terminal.js';
import {
    terminalEntityName,
    TerminalInputSchema,
    TerminalLocatorSchema,
    TerminalSnapshotSchema
} from './TerminalSchema.js';

export const TerminalContract: EntityContractType = {
    entity: terminalEntityName,
    entityClass: Terminal,
    inputSchema: TerminalLocatorSchema,
    dataSchema: TerminalSnapshotSchema,
    methods: {
        read: {
            kind: 'query',
            payload: TerminalLocatorSchema,
            result: TerminalSnapshotSchema,
            execution: 'class'
        },
        sendInput: {
            kind: 'mutation',
            payload: TerminalInputSchema,
            result: TerminalSnapshotSchema,
            execution: 'class'
        }
    },
    events: {
        data: {
            payload: TerminalSnapshotSchema
        }
    }
};