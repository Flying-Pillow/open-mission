import type { EntityContractType } from '../Entity/EntitySchema.js';
import { ArtifactEntity } from './Artifact.js';
import {
    missionArtifactEntityName,
    artifactIdentityPayloadSchema,
    artifactExecuteCommandPayloadSchema,
    artifactWriteDocumentPayloadSchema,
    missionArtifactSnapshotSchema,
    artifactDocumentSnapshotSchema,
    artifactCommandAcknowledgementSchema
} from './ArtifactSchema.js';

export const artifactEntityContract: EntityContractType = {
    entity: missionArtifactEntityName,
    entityClass: ArtifactEntity,
    methods: {
        read: {
            kind: 'query',
            payload: artifactIdentityPayloadSchema,
            result: missionArtifactSnapshotSchema,
            execution: 'class'
        },
        readDocument: {
            kind: 'query',
            payload: artifactIdentityPayloadSchema,
            result: artifactDocumentSnapshotSchema,
            execution: 'class'
        },
        writeDocument: {
            kind: 'mutation',
            payload: artifactWriteDocumentPayloadSchema,
            result: artifactDocumentSnapshotSchema,
            execution: 'class'
        },
        executeCommand: {
            kind: 'mutation',
            payload: artifactExecuteCommandPayloadSchema,
            result: artifactCommandAcknowledgementSchema,
            execution: 'class'
        }
    }
};
