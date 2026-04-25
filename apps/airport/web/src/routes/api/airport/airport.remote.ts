import path from 'node:path';
import { command, getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    airportHomeSnapshotSchema,
    githubVisibleRepositorySchema,
    missionRuntimeSnapshotSchema,
    repositorySchema,
    repositorySnapshotSchema
} from '@flying-pillow/mission-core/airport/runtime';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { getMissionWorktreesPath } from '@flying-pillow/mission-core/node';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { clearGithubAuthSession } from '$lib/server/github-auth.server';
import { missionControlSnapshotSchema } from '$lib/types/mission-control';

const airportRouteQuerySchema = z.object({});
const addAirportRepositoryInputSchema = z.object({
    repositoryPath: z.string().trim().min(1, 'Repository path is required.').refine(
        (value) => path.isAbsolute(value),
        'Repository path must be an absolute local checkout path on the daemon host.'
    ),
    githubRepository: z.string().trim().min(1).optional()
});
const missionRouteQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    missionId: z.string().trim().min(1)
});

const airportRouteDataSchema = z.object({
    loginHref: z.string().trim().min(1),
    airportHome: airportHomeSnapshotSchema
});
const githubRepositoriesResultSchema = z.object({
    githubRepositories: z.array(githubVisibleRepositorySchema),
    githubRepositoriesError: z.string().trim().min(1).optional()
});

const addAirportRepositoryResultSchema = z.object({
    repositoryPath: z.string().trim().min(1),
    githubRepository: z.string().trim().min(1).optional()
});

const missionSnapshotBundleSchema = z.object({
    airportRepositories: z.array(repositorySchema),
    repositorySnapshot: repositorySnapshotSchema,
    missionControl: missionControlSnapshotSchema,
    missionWorktreePath: z.string().trim().min(1),
    repositoryId: z.string().trim().min(1),
    missionId: z.string().trim().min(1)
});

const airportLogoutResultSchema = z.object({
    redirectTo: z.string().trim().min(1)
});

export type AirportRouteData = z.infer<typeof airportRouteDataSchema>;
export type AddAirportRepositoryResult = z.infer<typeof addAirportRepositoryResultSchema>;
export type MissionSnapshotBundle = z.infer<typeof missionSnapshotBundleSchema>;

async function buildMissionSnapshotBundle(input: {
    repositoryId: string;
    missionId: string;
}): Promise<MissionSnapshotBundle> {
    const event = getRequestEvent();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
        repositoryId: input.repositoryId
    });
    const { missionId } = missionRuntimeRouteParamsSchema.parse({
        missionId: input.missionId
    });
    const gateway = new AirportWebGateway(event.locals);
    const { airport, entities } = gateway;
    const airportHome = await airport.getHomeSnapshot();
    const repositorySnapshot = await entities.readRepository({
        repositoryId,
        selectedMissionId: missionId
    });
    const missionWorktreePath = path.join(
        getMissionWorktreesPath(repositorySnapshot.repository.repositoryRootPath),
        missionId
    );
    const missionControl = await entities.readMissionControl({
        missionId,
        surfacePath: missionWorktreePath
    });

    return missionSnapshotBundleSchema.parse({
        airportRepositories: airportHome.repositories,
        repositorySnapshot,
        missionControl,
        missionWorktreePath,
        repositoryId,
        missionId
    });
}

export const getAirportRouteData = query(airportRouteQuerySchema, async () => {
    const event = getRequestEvent();
    const gateway = new AirportWebGateway(event.locals);

    return airportRouteDataSchema.parse({
        loginHref: '/login?redirectTo=/airport',
        airportHome: await gateway.airport.getHomeSnapshot()
    });
});

export const readVisibleGitHubRepositories = command(z.object({}), async () => {
    const event = getRequestEvent();
    const gateway = new AirportWebGateway(event.locals);
    let githubRepositories = [];
    let githubRepositoriesError: string | undefined;

    try {
        githubRepositories = await gateway.airport.listVisibleGitHubRepositories();
    } catch (error) {
        githubRepositoriesError = error instanceof Error ? error.message : String(error);
    }

    return githubRepositoriesResultSchema.parse({
        githubRepositories,
        ...(githubRepositoriesError ? { githubRepositoriesError } : {})
    });
});

export const addAirportRepository = command(addAirportRepositoryInputSchema, async (input) => {
    const event = getRequestEvent();
    const gateway = new AirportWebGateway(event.locals);
    const selectedGitHubRepository = input.githubRepository?.trim();
    const repository = selectedGitHubRepository
        ? await gateway.airport.cloneGitHubRepository(selectedGitHubRepository, input.repositoryPath)
        : await gateway.airport.inspectRepositoryPath(input.repositoryPath).then(
            (inspectedRepository) => gateway.airport.addRepository(inspectedRepository.repositoryRootPath)
        );

    return addAirportRepositoryResultSchema.parse({
        repositoryPath: repository.repositoryRootPath,
        ...(selectedGitHubRepository ? { githubRepository: selectedGitHubRepository } : {})
    });
});

export const logoutAirportSession = command(z.object({}), async () => {
    const event = getRequestEvent();
    await clearGithubAuthSession(event.cookies);
    event.locals.githubAuthToken = undefined;

    return airportLogoutResultSchema.parse({
        redirectTo: '/'
    });
});

export const readMissionSnapshotBundle = command(missionRouteQuerySchema, async (input) => {
    return await buildMissionSnapshotBundle(input);
});