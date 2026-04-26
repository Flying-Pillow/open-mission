import { z } from 'zod/v4';
import {
    entityCommandAcknowledgementSchema,
    entityCommandListSnapshotSchema
} from './EntityRemote.js';

export const missionArtifactEntityName = 'Artifact' as const;
export const artifactEntityName = missionArtifactEntityName;

export const artifactIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    artifactId: z.string().trim().min(1)
}).strict();

export const artifactEntityReferenceSchema = artifactIdentityPayloadSchema.extend({
    entity: z.literal(missionArtifactEntityName)
}).strict();

export const artifactExecuteCommandPayloadSchema = artifactIdentityPayloadSchema.extend({
    commandId: z.string().trim().min(1),
    input: z.unknown().optional()
}).strict();

export const artifactWriteDocumentPayloadSchema = artifactIdentityPayloadSchema.extend({
    content: z.string()
}).strict();

export const missionArtifactSnapshotSchema = z.object({
    artifactId: z.string().trim().min(1),
    kind: z.enum(['mission', 'stage', 'task']),
    label: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    key: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
}).strict();

export const artifactSnapshotSchema = missionArtifactSnapshotSchema;

export const artifactDocumentSnapshotSchema = z.object({
    filePath: z.string().trim().min(1),
    content: z.string(),
    updatedAt: z.string().trim().min(1).optional()
}).strict();

export const artifactCommandListSnapshotSchema = entityCommandListSnapshotSchema.extend({
    entity: z.literal(missionArtifactEntityName),
    missionId: z.string().trim().min(1),
    artifactId: z.string().trim().min(1)
}).strict();

export const artifactCommandAcknowledgementSchema = entityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionArtifactEntityName),
    method: z.literal('executeCommand'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    artifactId: z.string().trim().min(1),
    commandId: z.string().trim().min(1)
}).strict();

export const artifactRemoteQueryPayloadSchemas = {
    read: artifactIdentityPayloadSchema,
    readDocument: artifactIdentityPayloadSchema,
    listCommands: artifactIdentityPayloadSchema
} as const;

export const artifactRemoteCommandPayloadSchemas = {
    writeDocument: artifactWriteDocumentPayloadSchema,
    executeCommand: artifactExecuteCommandPayloadSchema
} as const;

export const artifactRemoteQueryResultSchemas = {
    read: missionArtifactSnapshotSchema,
    readDocument: artifactDocumentSnapshotSchema,
    listCommands: artifactCommandListSnapshotSchema
} as const;

export const artifactRemoteCommandResultSchemas = {
    writeDocument: artifactDocumentSnapshotSchema,
    executeCommand: artifactCommandAcknowledgementSchema
} as const;

export type ArtifactIdentityPayload = z.infer<typeof artifactIdentityPayloadSchema>;
export type ArtifactEntityReference = z.infer<typeof artifactEntityReferenceSchema>;
export type ArtifactExecuteCommandPayload = z.infer<typeof artifactExecuteCommandPayloadSchema>;
export type ArtifactWriteDocumentPayload = z.infer<typeof artifactWriteDocumentPayloadSchema>;
export type MissionArtifactSnapshot = z.infer<typeof missionArtifactSnapshotSchema>;
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>;
export type ArtifactDocumentSnapshot = z.infer<typeof artifactDocumentSnapshotSchema>;
export type ArtifactCommandListSnapshot = z.infer<typeof artifactCommandListSnapshotSchema>;
export type ArtifactCommandAcknowledgement = z.infer<typeof artifactCommandAcknowledgementSchema>;
