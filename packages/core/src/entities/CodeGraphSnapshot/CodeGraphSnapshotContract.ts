import type { EntityContractType } from '../Entity/EntitySchema.js';
import { CodeGraphSnapshot } from './CodeGraphSnapshot.js';
import {
    codeGraphSnapshotEntityName,
    CodeGraphSnapshotCollectionSchema,
    CodeGraphSnapshotFindSchema,
    CodeGraphSnapshotLocatorSchema,
    CodeGraphSnapshotSchema,
    CodeGraphSnapshotStorageSchema
} from './CodeGraphSnapshotSchema.js';

export const CodeGraphSnapshotContract: EntityContractType = {
    entity: codeGraphSnapshotEntityName,
    entityClass: CodeGraphSnapshot,
    inputSchema: CodeGraphSnapshotLocatorSchema,
    storageSchema: CodeGraphSnapshotStorageSchema,
    dataSchema: CodeGraphSnapshotSchema,
    methods: {
        read: {
            kind: 'query',
            payload: CodeGraphSnapshotLocatorSchema,
            result: CodeGraphSnapshotSchema,
            execution: 'class'
        },
        find: {
            kind: 'query',
            payload: CodeGraphSnapshotFindSchema,
            result: CodeGraphSnapshotCollectionSchema,
            execution: 'class'
        }
    },
    events: {}
};
