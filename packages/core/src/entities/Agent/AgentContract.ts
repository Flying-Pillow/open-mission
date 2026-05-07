import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Agent } from './Agent.js';
import {
    agentEntityName,
    AgentDataSchema,
    AgentFindResultSchema,
    AgentFindSchema,
    AgentLocatorSchema
} from './AgentSchema.js';

export const AgentContract: EntityContractType = {
    entity: agentEntityName,
    entityClass: Agent,
    inputSchema: AgentLocatorSchema,
    storageSchema: AgentDataSchema,
    dataSchema: AgentDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: AgentLocatorSchema,
            result: AgentDataSchema,
            execution: 'class'
        },
        find: {
            kind: 'query',
            payload: AgentFindSchema,
            result: AgentFindResultSchema,
            execution: 'class'
        }
    },
    events: {}
};
