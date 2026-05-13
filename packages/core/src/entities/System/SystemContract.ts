import type { EntityContractType } from '../Entity/EntitySchema.js';
import { System } from './System.js';
import {
    systemEntityName,
    SystemAgentSettingsSchema,
    SystemConfigureSchema,
    SystemDataSchema,
    SystemReadSchema
} from './SystemSchema.js';

export const SystemContract: EntityContractType = {
    entity: systemEntityName,
    entityClass: System,
    inputSchema: SystemReadSchema,
    storageSchema: SystemDataSchema,
    dataSchema: SystemDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: SystemReadSchema,
            result: SystemDataSchema,
            execution: 'class'
        },
        configure: {
            kind: 'mutation',
            payload: SystemConfigureSchema,
            result: SystemDataSchema,
            execution: 'class'
        },
        configureAgent: {
            kind: 'mutation',
            payload: SystemAgentSettingsSchema,
            result: SystemDataSchema,
            execution: 'class'
        }
    },
    events: {}
};