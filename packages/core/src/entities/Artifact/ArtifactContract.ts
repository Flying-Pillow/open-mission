import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Artifact } from './Artifact.js';
import {
    artifactEntityName,
    ArtifactLocatorSchema,
    ArtifactCommandInputSchema,
    ArtifactStorageSchema,
    ArtifactDataSchema,
    ArtifactBodySchema,
    ArtifactCommandAcknowledgementSchema,
    ArtifactDataChangedSchema
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
        body: {
            kind: 'query',
            payload: ArtifactLocatorSchema,
            result: ArtifactBodySchema,
            execution: 'class'
        },
        command: {
            kind: 'mutation',
            payload: ArtifactCommandInputSchema,
            result: ArtifactCommandAcknowledgementSchema,
            execution: 'class'
        }
    },
    events: {
        'data.changed': {
            payload: ArtifactDataChangedSchema
        }
    }
};
