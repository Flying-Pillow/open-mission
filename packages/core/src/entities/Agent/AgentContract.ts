import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Agent } from './Agent.js';
import {
    agentEntityName,
    AgentConnectionTestResultSchema,
    AgentSchema,
    AgentStorageSchema,
    AgentCollectionSchema,
    AgentFindSchema,
    AgentLocatorSchema,
    AgentTestConnectionInputSchema
} from './AgentSchema.js';

export const AgentContract: EntityContractType = {
    entity: agentEntityName,
    entityClass: Agent,
    inputSchema: AgentLocatorSchema,
    storageSchema: AgentStorageSchema,
    dataSchema: AgentSchema,
    methods: {
        read: {
            kind: 'query',
            payload: AgentLocatorSchema,
            result: AgentSchema,
            execution: 'class'
        },
        find: {
            kind: 'query',
            payload: AgentFindSchema,
            result: AgentCollectionSchema,
            execution: 'class'
        },
        testConnection: {
            kind: 'mutation',
            payload: AgentTestConnectionInputSchema,
            result: AgentConnectionTestResultSchema,
            execution: 'class',
            ui: {
                label: 'Test connection',
                description: 'Run a one-shot adapter readiness probe without starting a managed AgentExecution.',
                tone: 'neutral',
                presentationOrder: 100
            }
        }
    },
    events: {}
};
