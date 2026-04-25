import { z } from 'zod/v4';
import {
    airportHomeSnapshotSchema,
    githubIssueDetailSchema,
    missionFromBriefInputSchema,
    missionFromIssueInputSchema,
    repositorySnapshotSchema,
    trackedIssueSummarySchema,
    type AirportHomeSnapshot,
    type GitHubIssueDetail,
    type RepositorySnapshot,
    type TrackedIssueSummary
} from '@flying-pillow/mission-core/airport/runtime';

const repositoryEntityReferenceSchema = z.object({
    entity: z.literal('Repository'),
    repositoryId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
});

const airportEntityReferenceSchema = z.object({
    entity: z.literal('Airport')
});

export const entityQueryInvocationSchema = z.union([
    z.object({
        reference: airportEntityReferenceSchema,
        method: z.literal('listRepositories'),
        args: z.object({})
    }),
    z.object({
        reference: repositoryEntityReferenceSchema,
        method: z.literal('read'),
        args: z.object({})
    }),
    z.object({
        reference: repositoryEntityReferenceSchema,
        method: z.literal('listIssues'),
        args: z.object({})
    }),
    z.object({
        reference: repositoryEntityReferenceSchema,
        method: z.literal('getIssue'),
        args: z.object({
            issueNumber: z.coerce.number().int().positive()
        })
    })
]);

export const entityCommandInvocationSchema = z.union([
    z.object({
        reference: repositoryEntityReferenceSchema,
        method: z.literal('startMissionFromIssue'),
        args: missionFromIssueInputSchema
    }),
    z.object({
        reference: repositoryEntityReferenceSchema,
        method: z.literal('startMissionFromBrief'),
        args: missionFromBriefInputSchema
    })
]);

export const entityFormInvocationSchema = z.object({
    reference: repositoryEntityReferenceSchema,
    method: z.literal('startMissionFromBrief'),
    args: missionFromBriefInputSchema
});

export const missionMutationResultSchema = z.object({
    missionId: z.string().trim().min(1),
    redirectTo: z.string().trim().min(1)
});

export type EntityQueryInvocation = z.infer<typeof entityQueryInvocationSchema>;
export type EntityCommandInvocation = z.infer<typeof entityCommandInvocationSchema>;
export type EntityFormInvocation = z.infer<typeof entityFormInvocationSchema>;
export type MissionMutationResult = z.infer<typeof missionMutationResultSchema>;

export type EntityRemoteGateway = {
    getAirportHomeSnapshot(): Promise<AirportHomeSnapshot>;
    readRepository(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<RepositorySnapshot>;
    listRepositoryIssues(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<TrackedIssueSummary[]>;
    readRepositoryIssue(input: {
        repositoryId: string;
        repositoryRootPath?: string;
        issueNumber: number;
    }): Promise<GitHubIssueDetail>;
    startMissionFromIssue(input: {
        repositoryId: string;
        issueNumber: number;
    }): Promise<{ missionId?: string | undefined }>;
    startMissionFromBrief(input: {
        repositoryId: string;
        brief: z.infer<typeof missionFromBriefInputSchema>;
    }): Promise<{ missionId?: string | undefined }>;
};

export async function executeEntityQuery(
    gateway: EntityRemoteGateway,
    input: EntityQueryInvocation
): Promise<z.infer<typeof entityQueryResultSchema>> {
    const invocation = entityQueryInvocationSchema.parse(input);

    switch (invocation.method) {
        case 'listRepositories':
            return airportHomeSnapshotSchema.parse(await gateway.getAirportHomeSnapshot()).repositories;
        case 'read':
            return repositorySnapshotSchema.parse(
                await gateway.readRepository({
                    repositoryId: invocation.reference.repositoryId,
                    ...(invocation.reference.repositoryRootPath
                        ? { repositoryRootPath: invocation.reference.repositoryRootPath }
                        : {})
                })
            );
        case 'listIssues':
            return z.array(trackedIssueSummarySchema).parse(
                await gateway.listRepositoryIssues({
                    repositoryId: invocation.reference.repositoryId,
                    ...(invocation.reference.repositoryRootPath
                        ? { repositoryRootPath: invocation.reference.repositoryRootPath }
                        : {})
                })
            );
        case 'getIssue':
            return githubIssueDetailSchema.parse(
                await gateway.readRepositoryIssue({
                    repositoryId: invocation.reference.repositoryId,
                    ...(invocation.reference.repositoryRootPath
                        ? { repositoryRootPath: invocation.reference.repositoryRootPath }
                        : {}),
                    issueNumber: invocation.args.issueNumber
                })
            );
    }
}

export async function executeEntityCommand(
    gateway: EntityRemoteGateway,
    input: EntityCommandInvocation
): Promise<MissionMutationResult> {
    const invocation = entityCommandInvocationSchema.parse(input);

    const status = invocation.method === 'startMissionFromIssue'
        ? await gateway.startMissionFromIssue({
            repositoryId: invocation.reference.repositoryId,
            issueNumber: invocation.args.issueNumber
        })
        : await gateway.startMissionFromBrief({
            repositoryId: invocation.reference.repositoryId,
            brief: invocation.args
        });

    return missionMutationResultSchema.parse({
        missionId: requireMissionId(status.missionId, invocation.method),
        redirectTo: toRepositoryMissionRoute(invocation.reference.repositoryId, status.missionId)
    });
}

export async function executeEntityForm(
    gateway: EntityRemoteGateway,
    input: EntityFormInvocation
): Promise<MissionMutationResult> {
    const invocation = entityFormInvocationSchema.parse(input);
    const status = await gateway.startMissionFromBrief({
        repositoryId: invocation.reference.repositoryId,
        brief: invocation.args
    });

    return missionMutationResultSchema.parse({
        missionId: requireMissionId(status.missionId, invocation.method),
        redirectTo: toRepositoryMissionRoute(invocation.reference.repositoryId, status.missionId)
    });
}

export async function listAirportRepositoriesThroughEntityBoundary(
    gateway: EntityRemoteGateway
): Promise<z.infer<typeof repositoryListResultSchema>> {
    return repositoryListResultSchema.parse(
        await executeEntityQuery(gateway, {
            reference: { entity: 'Airport' },
            method: 'listRepositories',
            args: {}
        })
    );
}

export async function listRepositoryIssuesThroughEntityBoundary(
    gateway: EntityRemoteGateway,
    input: {
        repositoryId: string;
        repositoryRootPath: string;
    }
): Promise<z.infer<typeof repositoryIssuesResultSchema>> {
    return repositoryIssuesResultSchema.parse(
        await executeEntityQuery(gateway, {
            reference: {
                entity: 'Repository',
                repositoryId: input.repositoryId,
                repositoryRootPath: input.repositoryRootPath
            },
            method: 'listIssues',
            args: {}
        })
    );
}

export async function getRepositoryThroughEntityBoundary(
    gateway: EntityRemoteGateway,
    input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }
): Promise<RepositorySnapshot> {
    return repositorySnapshotSchema.parse(
        await executeEntityQuery(gateway, {
            reference: {
                entity: 'Repository',
                repositoryId: input.repositoryId,
                ...(input.repositoryRootPath
                    ? { repositoryRootPath: input.repositoryRootPath }
                    : {})
            },
            method: 'read',
            args: {}
        })
    );
}

export async function getRepositoryIssueThroughEntityBoundary(
    gateway: EntityRemoteGateway,
    input: {
        repositoryId: string;
        repositoryRootPath: string;
        issueNumber: number;
    }
): Promise<GitHubIssueDetail> {
    return githubIssueDetailSchema.parse(
        await executeEntityQuery(gateway, {
            reference: {
                entity: 'Repository',
                repositoryId: input.repositoryId,
                repositoryRootPath: input.repositoryRootPath
            },
            method: 'getIssue',
            args: {
                issueNumber: input.issueNumber
            }
        })
    );
}

export async function startMissionFromIssueThroughEntityBoundary(
    gateway: EntityRemoteGateway,
    input: {
        repositoryId: string;
        issueNumber: number;
    }
): Promise<MissionMutationResult> {
    return executeEntityCommand(gateway, {
        reference: {
            entity: 'Repository',
            repositoryId: input.repositoryId
        },
        method: 'startMissionFromIssue',
        args: {
            issueNumber: input.issueNumber
        }
    });
}

export async function startMissionFromBriefThroughEntityBoundary(
    gateway: EntityRemoteGateway,
    input: {
        repositoryId: string;
        brief: z.infer<typeof missionFromBriefInputSchema>;
    }
): Promise<MissionMutationResult> {
    return executeEntityForm(gateway, {
        reference: {
            entity: 'Repository',
            repositoryId: input.repositoryId
        },
        method: 'startMissionFromBrief',
        args: input.brief
    });
}

const repositoryListResultSchema = z.array(repositorySnapshotSchema.shape.repository);
const repositorySnapshotResultSchema = repositorySnapshotSchema;
const repositoryIssuesResultSchema = z.array(trackedIssueSummarySchema);
const entityQueryResultSchema = z.union([
    repositoryListResultSchema,
    repositorySnapshotResultSchema,
    repositoryIssuesResultSchema,
    githubIssueDetailSchema
]);

function requireMissionId(missionId: string | undefined, method: string): string {
    const normalizedMissionId = missionId?.trim();
    if (!normalizedMissionId) {
        throw new Error(`Entity method '${method}' did not return a missionId.`);
    }

    return normalizedMissionId;
}

function toRepositoryMissionRoute(repositoryId: string, missionId: string | undefined): string {
    return `/repository/${encodeURIComponent(repositoryId)}/missions/${encodeURIComponent(requireMissionId(missionId, 'mission-route'))}`;
}
