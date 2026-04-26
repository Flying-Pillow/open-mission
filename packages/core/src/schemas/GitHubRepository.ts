import { z } from 'zod/v4';
import { githubVisibleRepositorySchema } from './AirportClient.js';
import { repositorySnapshotSchema } from './Repository.js';

export const gitHubRepositoryEntityName = 'GitHubRepository' as const;

export const gitHubRepositoryFindPayloadSchema = z.object({}).strict();

export const gitHubRepositoryClonePayloadSchema = z.object({
	githubRepository: z.string().trim().min(1),
	destinationPath: z.string().trim().min(1)
}).strict();

export const gitHubRepositoryRemoteQueryResultSchemas = {
	find: z.array(githubVisibleRepositorySchema)
} as const;

export const gitHubRepositoryRemoteCommandResultSchemas = {
	clone: repositorySnapshotSchema
} as const;

export type GitHubRepositoryFindPayload = z.infer<typeof gitHubRepositoryFindPayloadSchema>;
export type GitHubRepositoryClonePayload = z.infer<typeof gitHubRepositoryClonePayloadSchema>;
