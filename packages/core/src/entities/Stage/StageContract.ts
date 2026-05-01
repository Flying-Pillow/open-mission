import { z } from 'zod/v4';
import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Stage } from './Stage.js';
import {
    stageEntityName,
    StageLocatorSchema,
    StageExecuteCommandInputSchema,
    StageEventSubjectSchema,
    StageStorageSchema,
    StageDataSchema,
    StageCommandAcknowledgementSchema
} from './StageSchema.js';

const StageSnapshotChangedEventSchema = z.object({
    reference: StageEventSubjectSchema,
    snapshot: StageDataSchema
}).strict();

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
        executeCommand: {
            kind: 'mutation',
            payload: StageExecuteCommandInputSchema,
            result: StageCommandAcknowledgementSchema,
            execution: 'entity'
        }
    },
    events: {
        'snapshot.changed': {
            payload: StageSnapshotChangedEventSchema
        }
    }
};
