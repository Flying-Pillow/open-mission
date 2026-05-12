import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityStorageSchema
} from '../Entity/EntitySchema.js';

export const artifactEntityName = 'Artifact' as const;

export const ArtifactCommandIds = {
    body: 'artifact.body'
} as const;

export const ArtifactCommandIdSchema = z.enum([
    ArtifactCommandIds.body
]);

export const ArtifactLocatorSchema = z.object({
    missionId: z.string().trim().min(1).optional(),
    repositoryRootPath: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1)
}).strict();

export const ArtifactEventLocatorSchema = ArtifactLocatorSchema.extend({
    entity: z.literal(artifactEntityName)
}).strict();

export const ArtifactBodySchema = z.object({
    body: z.unknown()
}).strict();

export const ArtifactCommandInputSchema = ArtifactLocatorSchema.extend({
    commandId: ArtifactCommandIdSchema,
    input: ArtifactBodySchema
}).strict();

export const ArtifactStorageSchema = EntityStorageSchema.extend({
    kind: z.enum(['repository', 'worktree', 'mission', 'stage', 'task']),
    label: z.string().trim().min(1),
    fileName: z.string().trim().min(1),
    key: z.string().trim().min(1).optional(),
    missionId: z.string().trim().min(1).optional(),
    repositoryRootPath: z.string().trim().min(1).optional(),
    rootPath: z.string().trim().min(1).optional(),
    stageId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    relativePath: z.string().trim().min(1).optional()
}).strict();

export const ArtifactDataSchema = ArtifactStorageSchema.extend({}).strict();

export const ArtifactCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(artifactEntityName),
    method: z.literal('command'),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1).optional(),
    commandId: ArtifactCommandIdSchema
}).strict();

export const ArtifactDataChangedSchema = z.object({
    artifactEventLocator: ArtifactEventLocatorSchema,
    data: ArtifactDataSchema
}).strict();

export type ArtifactLocatorType = z.infer<typeof ArtifactLocatorSchema>;
export type ArtifactEventLocatorType = z.infer<typeof ArtifactEventLocatorSchema>;
export type ArtifactCommandIdType = z.infer<typeof ArtifactCommandIdSchema>;
export type ArtifactBodyType = z.infer<typeof ArtifactBodySchema>;
export type ArtifactCommandInputType = z.infer<typeof ArtifactCommandInputSchema>;
export type ArtifactStorageType = z.infer<typeof ArtifactStorageSchema>;
export type ArtifactDataType = z.infer<typeof ArtifactDataSchema>;
export type ArtifactCommandAcknowledgementType = z.infer<typeof ArtifactCommandAcknowledgementSchema>;
export type ArtifactDataChangedType = z.infer<typeof ArtifactDataChangedSchema>;

