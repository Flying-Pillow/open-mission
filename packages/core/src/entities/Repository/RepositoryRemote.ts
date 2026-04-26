import { z } from 'zod/v4';
import {
	githubIssueDetailSchema,
	missionFromBriefInputSchema,
	missionFromIssueInputSchema,
	repositorySnapshotSchema,
	trackedIssueSummarySchema
} from '../../airport/runtime.js';

export const repositoryEntityName = 'Repository' as const;

export const repositoryIdentityPayloadSchema = z.object({
	repositoryId: z.string().trim().min(1),
	repositoryRootPath: z.string().trim().min(1).optional()
});

export const repositoryFindPayloadSchema = z.object({}).passthrough();
export const repositoryReadPayloadSchema = repositoryIdentityPayloadSchema;
export const repositoryListIssuesPayloadSchema = repositoryIdentityPayloadSchema;
export const repositoryGetIssuePayloadSchema = repositoryIdentityPayloadSchema.extend({
	issueNumber: z.coerce.number().int().positive()
});
export const repositoryStartMissionFromIssuePayloadSchema = repositoryIdentityPayloadSchema.extend(
	missionFromIssueInputSchema.shape
);
export const repositoryStartMissionFromBriefPayloadSchema = repositoryIdentityPayloadSchema.extend(
	missionFromBriefInputSchema.shape
);

export const repositoryMissionMutationStatusSchema = z.object({
	missionId: z.string().trim().min(1)
});

export const repositoryRemoteQueryPayloadSchemas = {
	find: repositoryFindPayloadSchema,
	read: repositoryReadPayloadSchema,
	listIssues: repositoryListIssuesPayloadSchema,
	getIssue: repositoryGetIssuePayloadSchema
} as const;

export const repositoryRemoteCommandPayloadSchemas = {
	startMissionFromIssue: repositoryStartMissionFromIssuePayloadSchema,
	startMissionFromBrief: repositoryStartMissionFromBriefPayloadSchema
} as const;

export const repositoryRemoteQueryResultSchemas = {
	find: z.array(repositorySnapshotSchema),
	read: repositorySnapshotSchema,
	listIssues: z.array(trackedIssueSummarySchema),
	getIssue: githubIssueDetailSchema
} as const;

export type RepositoryFindPayload = z.infer<typeof repositoryFindPayloadSchema>;
export type RepositoryReadPayload = z.infer<typeof repositoryReadPayloadSchema>;
export type RepositoryListIssuesPayload = z.infer<typeof repositoryListIssuesPayloadSchema>;
export type RepositoryGetIssuePayload = z.infer<typeof repositoryGetIssuePayloadSchema>;
export type RepositoryStartMissionFromIssuePayload = z.infer<typeof repositoryStartMissionFromIssuePayloadSchema>;
export type RepositoryStartMissionFromBriefPayload = z.infer<typeof repositoryStartMissionFromBriefPayloadSchema>;