import { describe, expect, it, vi } from 'vitest';
import type {
    AirportHomeSnapshot,
    GitHubIssueDetail,
    TrackedIssueSummary
} from '@flying-pillow/mission-core/airport/runtime';
import {
    entityCommandInvocationSchema,
    entityFormInvocationSchema,
    entityQueryInvocationSchema,
    executeEntityCommand,
    executeEntityForm,
    executeEntityQuery,
    getRepositoryIssueThroughEntityBoundary,
    listAirportRepositoriesThroughEntityBoundary,
    listRepositoryIssuesThroughEntityBoundary,
    startMissionFromBriefThroughEntityBoundary,
    startMissionFromIssueThroughEntityBoundary,
    type EntityRemoteGateway
} from './dispatch';

function createGateway(): EntityRemoteGateway & {
    getAirportHomeSnapshot: ReturnType<typeof vi.fn>;
    getRepositoryIssues: ReturnType<typeof vi.fn>;
    getRepositoryIssueDetail: ReturnType<typeof vi.fn>;
    createMissionFromIssue: ReturnType<typeof vi.fn>;
    createMissionFromBrief: ReturnType<typeof vi.fn>;
} {
    const airportHome: AirportHomeSnapshot = {
        repositories: [
            {
                repositoryId: 'repo-1',
                repositoryRootPath: '/workspace/repo-1',
                label: 'repo-1',
                description: 'Repository 1'
            }
        ]
    };
    const issueList: TrackedIssueSummary[] = [
        {
            number: 42,
            title: 'Issue 42',
            url: 'https://example.test/issues/42',
            labels: ['bug'],
            assignees: ['octocat']
        }
    ];
    const issueDetail: GitHubIssueDetail = {
        number: 42,
        title: 'Issue 42',
        body: 'Detailed issue body',
        url: 'https://example.test/issues/42',
        labels: ['bug'],
        assignees: ['octocat']
    };

    return {
        getAirportHomeSnapshot: vi.fn(async () => airportHome),
        getRepositoryIssues: vi.fn(async () => issueList),
        getRepositoryIssueDetail: vi.fn(async () => issueDetail),
        createMissionFromIssue: vi.fn(async () => ({ missionId: 'mission-42' })),
        createMissionFromBrief: vi.fn(async () => ({ missionId: 'mission-brief' }))
    };
}

describe('entity remote invocation schemas', () => {
    it('accept reference-style query, command, and form invocations', () => {
        expect(() =>
            entityQueryInvocationSchema.parse({
                reference: { entity: 'Airport' },
                method: 'listRepositories',
                args: {}
            })
        ).not.toThrow();
        expect(() =>
            entityCommandInvocationSchema.parse({
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'startMissionFromIssue',
                args: { issueNumber: 42 }
            })
        ).not.toThrow();
        expect(() =>
            entityFormInvocationSchema.parse({
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'startMissionFromBrief',
                args: { title: 'Title', body: 'Body', type: 'feature' }
            })
        ).not.toThrow();
    });

    it('reject route-local query drift outside the stable entity-method surface', () => {
        expect(() =>
            entityQueryInvocationSchema.parse({
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'getRepositoryIssues',
                args: {}
            })
        ).toThrow();
    });
});

describe('entity remote dispatch', () => {
    it('routes airport and repository queries through the generic dispatcher', async () => {
        const gateway = createGateway();

        await expect(
            executeEntityQuery(gateway, {
                reference: { entity: 'Airport' },
                method: 'listRepositories',
                args: {}
            })
        ).resolves.toEqual([
            expect.objectContaining({ repositoryId: 'repo-1' })
        ]);
        await expect(
            executeEntityQuery(gateway, {
                reference: {
                    entity: 'Repository',
                    repositoryId: 'repo-1',
                    repositoryRootPath: '/workspace/repo-1'
                },
                method: 'listIssues',
                args: {}
            })
        ).resolves.toEqual([
            expect.objectContaining({ number: 42 })
        ]);
        await expect(
            executeEntityQuery(gateway, {
                reference: {
                    entity: 'Repository',
                    repositoryId: 'repo-1',
                    repositoryRootPath: '/workspace/repo-1'
                },
                method: 'getIssue',
                args: { issueNumber: 42 }
            })
        ).resolves.toEqual(expect.objectContaining({ number: 42 }));

        expect(gateway.getAirportHomeSnapshot).toHaveBeenCalledTimes(1);
        expect(gateway.getRepositoryIssues).toHaveBeenCalledWith({
            repositoryId: 'repo-1',
            repositoryRootPath: '/workspace/repo-1'
        });
        expect(gateway.getRepositoryIssueDetail).toHaveBeenCalledWith({
            repositoryId: 'repo-1',
            repositoryRootPath: '/workspace/repo-1',
            issueNumber: 42
        });
    });

    it('routes repository commands and forms through the generic dispatcher', async () => {
        const gateway = createGateway();

        await expect(
            executeEntityCommand(gateway, {
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'startMissionFromIssue',
                args: { issueNumber: 42 }
            })
        ).resolves.toEqual({
            missionId: 'mission-42',
            redirectTo: '/repository/repo-1/missions/mission-42'
        });
        await expect(
            executeEntityForm(gateway, {
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'startMissionFromBrief',
                args: { title: 'Title', body: 'Body', type: 'feature' }
            })
        ).resolves.toEqual({
            missionId: 'mission-brief',
            redirectTo: '/repository/repo-1/missions/mission-brief'
        });
    });

    it('fails explicitly when a mission mutation does not return a missionId', async () => {
        const gateway = createGateway();
        gateway.createMissionFromIssue.mockResolvedValueOnce({});

        await expect(
            executeEntityCommand(gateway, {
                reference: { entity: 'Repository', repositoryId: 'repo-1' },
                method: 'startMissionFromIssue',
                args: { issueNumber: 42 }
            })
        ).rejects.toThrow("Entity method 'startMissionFromIssue' did not return a missionId.");
    });
});

describe('transitional remote glue', () => {
    it('keeps airport and repository legacy remotes transport-only', async () => {
        const gateway = createGateway();

        await expect(listAirportRepositoriesThroughEntityBoundary(gateway)).resolves.toEqual([
            expect.objectContaining({ repositoryId: 'repo-1' })
        ]);
        await expect(
            listRepositoryIssuesThroughEntityBoundary(gateway, {
                repositoryId: 'repo-1',
                repositoryRootPath: '/workspace/repo-1'
            })
        ).resolves.toEqual([
            expect.objectContaining({ number: 42 })
        ]);
        await expect(
            getRepositoryIssueThroughEntityBoundary(gateway, {
                repositoryId: 'repo-1',
                repositoryRootPath: '/workspace/repo-1',
                issueNumber: 42
            })
        ).resolves.toEqual(expect.objectContaining({ number: 42 }));
        await expect(
            startMissionFromIssueThroughEntityBoundary(gateway, {
                repositoryId: 'repo-1',
                issueNumber: 42
            })
        ).resolves.toEqual({
            missionId: 'mission-42',
            redirectTo: '/repository/repo-1/missions/mission-42'
        });
        await expect(
            startMissionFromBriefThroughEntityBoundary(gateway, {
                repositoryId: 'repo-1',
                brief: { title: 'Title', body: 'Body', type: 'feature' }
            })
        ).resolves.toEqual({
            missionId: 'mission-brief',
            redirectTo: '/repository/repo-1/missions/mission-brief'
        });
    });
});
