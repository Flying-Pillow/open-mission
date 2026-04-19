// /apps/airport/web/src/routes/repository/[repositoryId]/issue.remote.ts: Client-callable remote queries for repository issue lists and issue details.
import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import { githubIssueDetailDtoSchema, trackedIssueSummaryDtoSchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';

const repositoryIssuesQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1)
});

const repositoryIssueQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1),
    issueNumber: z.number().int().positive()
});

export const getRepositoryIssues = query(repositoryIssuesQuerySchema, async (input) => {
    const { locals } = getRequestEvent();
    const gateway = new AirportWebGateway(locals);
    return z.array(trackedIssueSummaryDtoSchema).parse(
        await gateway.getRepositoryIssues({
            repositoryId: input.repositoryId,
            repositoryRootPath: input.repositoryRootPath
        })
    );
});

export const getRepositoryIssue = query(repositoryIssueQuerySchema, async (input) => {
    const { locals } = getRequestEvent();
    const gateway = new AirportWebGateway(locals);
    return githubIssueDetailDtoSchema.parse(
        await gateway.getRepositoryIssueDetail({
            repositoryId: input.repositoryId,
            repositoryRootPath: input.repositoryRootPath,
            issueNumber: input.issueNumber
        })
    );
});