import type { EntityContractType } from '../Entity/EntitySchema.js';
import { CodeObject } from './CodeObject.js';
import {
    codeObjectEntityName,
    CodeObjectCollectionSchema,
    CodeObjectFindSchema,
    CodeObjectLocatorSchema,
    CodeObjectSchema,
    CodeObjectStorageSchema
} from './CodeObjectSchema.js';

export const CodeObjectContract: EntityContractType = {
    entity: codeObjectEntityName,
    entityClass: CodeObject,
    inputSchema: CodeObjectLocatorSchema,
    storageSchema: CodeObjectStorageSchema,
    dataSchema: CodeObjectSchema,
    methods: {
        read: {
            kind: 'query',
            payload: CodeObjectLocatorSchema,
            result: CodeObjectSchema,
            execution: 'class'
        },
        find: {
            kind: 'query',
            payload: CodeObjectFindSchema,
            result: CodeObjectCollectionSchema,
            execution: 'class'
        }
    },
    events: {}
};
