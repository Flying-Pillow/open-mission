import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Task } from './Task.js';
import {
    taskEntityName,
    TaskLocatorSchema,
    TaskExecuteCommandInputSchema,
    TaskStorageSchema,
    TaskDataSchema,
    TaskCommandAcknowledgementSchema,
    TaskSnapshotChangedEventSchema
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
        executeCommand: {
            kind: 'mutation',
            payload: TaskExecuteCommandInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity'
        }
    },
    events: {
        'snapshot.changed': {
            payload: TaskSnapshotChangedEventSchema
        }
    }
};
