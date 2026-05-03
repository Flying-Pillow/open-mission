import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Task } from './Task.js';
import {
    taskEntityName,
    TaskLocatorSchema,
    TaskCommandInputSchema,
    TaskStorageSchema,
    TaskDataSchema,
    TaskCommandAcknowledgementSchema,
    TaskDataChangedSchema
} from './TaskSchema.js';

export const TaskContract: EntityContractType = {
    entity: taskEntityName,
    entityClass: Task,
    inputSchema: TaskLocatorSchema,
    storageSchema: TaskStorageSchema,
    dataSchema: TaskDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: TaskLocatorSchema,
            result: TaskDataSchema,
            execution: 'class'
        },
        command: {
            kind: 'mutation',
            payload: TaskCommandInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity'
        }
    },
    events: {
        'data.changed': {
            payload: TaskDataChangedSchema
        }
    }
};
