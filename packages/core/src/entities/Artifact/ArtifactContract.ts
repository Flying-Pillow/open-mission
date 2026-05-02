import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Artifact } from './Artifact.js';
import {
    artifactEntityName,
    ArtifactLocatorSchema,
    ArtifactWriteDocumentInputSchema,
    ArtifactStorageSchema,
    ArtifactDataSchema,
    ArtifactDocumentDataSchema,
    ArtifactSnapshotChangedEventSchema
} from './ArtifactSchema.js';

export const ArtifactContract: EntityContractType = {
    entity: artifactEntityName,
    entityClass: Artifact,
    inputSchema: ArtifactLocatorSchema,
    storageSchema: ArtifactStorageSchema,
    dataSchema: ArtifactDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: ArtifactLocatorSchema,
            result: ArtifactDataSchema,
            execution: 'class'
        },
        readDocument: {
            kind: 'query',
            payload: ArtifactLocatorSchema,
            result: ArtifactDocumentDataSchema,
            execution: 'class'
        },
        writeDocument: {
            kind: 'mutation',
            payload: ArtifactWriteDocumentInputSchema,
            result: ArtifactDocumentDataSchema,
            execution: 'class'
        }
    },
    events: {
        'snapshot.changed': {
            payload: ArtifactSnapshotChangedEventSchema
        }
    }
};
