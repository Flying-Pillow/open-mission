import path from 'node:path';
import { command, getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    airportHomeSnapshotSchema,
    githubVisibleRepositorySchema,
    missionRuntimeSnapshotSchema,
    repositorySchema,
    repositorySurfaceSnapshotSchema
} from '@flying-pillow/mission-core/airport/runtime';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { getMissionWorktreesPath } from '@flying-pillow/mission-core/node';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import { clearGithubAuthSession } from '$lib/server/github-auth.server';
import type { MissionControlSnapshot } from '$lib/types/mission-control';

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

const missionControlSnapshotSchema = z.object({
    missionRuntime: missionRuntimeSnapshotSchema,
    operatorStatus: z.custom<MissionControlSnapshot['operatorStatus']>(
        (value) => Boolean(value && typeof value === 'object'),
        'Mission control operator status is required.'
    )
});

const airportRouteDataSchema = z.object({
    loginHref: z.string().trim().min(1),
    airportHome: airportHomeSnapshotSchema,
    githubRepositories: z.array(githubVisibleRepositorySchema),
    githubRepositoriesError: z.string().trim().min(1).optional()
});

const addAirportRepositoryResultSchema = z.object({
    repositoryPath: z.string().trim().min(1),
    githubRepository: z.string().trim().min(1).optional()
});

const missionRouteDataSchema = z.object({
    airportRepositories: z.array(repositorySchema),
    repositorySurface: repositorySurfaceSnapshotSchema,
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
export type MissionRouteData = z.infer<typeof missionRouteDataSchema>;

export const getAirportRouteData = query(airportRouteQuerySchema, async () => {
    const event = getRequestEvent();
    const gateway = new AirportWebGateway(event.locals);
    let githubRepositories: AirportRouteData['githubRepositories'] = [];
    let githubRepositoriesError: string | undefined;

    try {
        githubRepositories = await gateway.listVisibleGitHubRepositories();
    } catch (error) {
        githubRepositoriesError = error instanceof Error ? error.message : String(error);
    }

    return airportRouteDataSchema.parse({
        loginHref: '/login?redirectTo=/airport',
        airportHome: await gateway.getAirportHomeSnapshot(),
        githubRepositories,
        ...(githubRepositoriesError ? { githubRepositoriesError } : {})
    });
});

export const addAirportRepository = command(addAirportRepositoryInputSchema, async (input) => {
    const event = getRequestEvent();
    const gateway = new AirportWebGateway(event.locals);
    const selectedGitHubRepository = input.githubRepository?.trim();
    const repository = selectedGitHubRepository
        ? await gateway.cloneGitHubRepository(selectedGitHubRepository, input.repositoryPath)
        : await gateway.inspectRepositoryPath(input.repositoryPath).then(
            (inspectedRepository) => gateway.addRepository(inspectedRepository.repositoryRootPath)
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

export const getMissionRouteData = query(missionRouteQuerySchema, async (input) => {
    const event = getRequestEvent();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
        repositoryId: input.repositoryId
    });
    const { missionId } = missionRuntimeRouteParamsSchema.parse({
        missionId: input.missionId
    });
    const gateway = new AirportWebGateway(event.locals);
    const airportHome = await gateway.getAirportHomeSnapshot();
    const repositorySurface = await gateway.getRepositorySurfaceSnapshot({
        repositoryId,
        selectedMissionId: missionId
    });
    const missionWorktreePath = path.join(
        getMissionWorktreesPath(repositorySurface.repository.repositoryRootPath),
        missionId
    );
    const missionControl = await gateway.getMissionControlSnapshot({
        missionId,
        surfacePath: missionWorktreePath
    });

    return missionRouteDataSchema.parse({
        airportRepositories: airportHome.repositories,
        repositorySurface,
        missionControl,
        missionWorktreePath,
        repositoryId,
        missionId
    });
});