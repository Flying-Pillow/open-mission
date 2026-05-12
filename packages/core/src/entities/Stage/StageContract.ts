import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Stage } from './Stage.js';
import {
    stageEntityName,
    StageLocatorSchema,
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
        generateTasks: {
            kind: 'mutation',
            payload: StageLocatorSchema,
            result: StageCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Generate Tasks',
                icon: 'list-plus',
                presentationOrder: 10
            }
        }
    },
    events: {
        'data.changed': {
            payload: StageDataChangedSchema
        }
    }
};
