import type { EntityContractType } from '../Entity/EntitySchema.js';
import { CodeRelation } from './CodeRelation.js';
import {
    codeRelationEntityName,
    CodeRelationCollectionSchema,
    CodeRelationFindSchema,
    CodeRelationLocatorSchema,
    CodeRelationSchema,
    CodeRelationStorageSchema
} from './CodeRelationSchema.js';

export const CodeRelationContract: EntityContractType = {
    entity: codeRelationEntityName,
    entityClass: CodeRelation,
    inputSchema: CodeRelationLocatorSchema,
    storageSchema: CodeRelationStorageSchema,
    dataSchema: CodeRelationSchema,
    methods: {
        read: {
            kind: 'query',
            payload: CodeRelationLocatorSchema,
            result: CodeRelationSchema,
            execution: 'class'
        },
        find: {
            kind: 'query',
            payload: CodeRelationFindSchema,
            result: CodeRelationCollectionSchema,
            execution: 'class'
        }
    },
    events: {}
};
