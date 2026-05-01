import { z } from 'zod/v4';
import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Task } from './Task.js';
import {
    taskEntityName,
    TaskLocatorSchema,
    TaskExecuteCommandInputSchema,
    TaskEventSubjectSchema,
    TaskStorageSchema,
    TaskDataSchema,
    TaskCommandAcknowledgementSchema
} from './TaskSchema.js';

const TaskSnapshotChangedEventSchema = z.object({
    reference: TaskEventSubjectSchema,
    snapshot: TaskDataSchema
}).strict();

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
