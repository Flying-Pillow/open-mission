import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Stage } from './Stage.js';
import {
    stageEntityName,
    StageLocatorSchema,
    StageCommandInputSchema,
    StageStorageSchema,
    StageDataSchema,
    StageCommandAcknowledgementSchema,
    StageDataChangedSchema
} from './StageSchema.js';

export const StageContract: EntityContractType = {
    entity: stageEntityName,
    entityClass: Stage,
    inputSchema: StageLocatorSchema,
    storageSchema: StageStorageSchema,
    dataSchema: StageDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: StageLocatorSchema,
            result: StageDataSchema,
            execution: 'class'
        },
        command: {
            kind: 'mutation',
            payload: StageCommandInputSchema,
            result: StageCommandAcknowledgementSchema,
            execution: 'entity'
        }
    },
    events: {
        'data.changed': {
            payload: StageDataChangedSchema
        }
    }
};
