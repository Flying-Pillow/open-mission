// /apps/airport/web/src/routes/repository/[repositoryId]/issue.remote.ts: Transitional repository query glue over the generic entity boundary.
import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    githubIssueDetailSchema,
    trackedIssueSummarySchema
} from '@flying-pillow/mission-core/airport/runtime';
import { executeEntityQuery } from '../../../api/entities/remote/dispatch';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

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
    return z.array(trackedIssueSummarySchema).parse(
        await executeEntityQuery(
            new EntityProxy(getRequestEvent().locals),
            {
                entity: 'Repository',
                method: 'listIssues',
                payload: input
            }
        )
    );
});

export const getRepositoryIssue = query(repositoryIssueQuerySchema, async (input) => {
    return githubIssueDetailSchema.parse(
        await executeEntityQuery(
            new EntityProxy(getRequestEvent().locals),
            {
                entity: 'Repository',
                method: 'getIssue',
                payload: input
            }
        )
    );
});
