import { command, getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    airportHomeSnapshotSchema,
    repositorySchema,
    repositorySnapshotSchema
} from '@flying-pillow/mission-core/schemas';
import { executeEntityQuery } from '../entities/remote/dispatch';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core/schemas';
import { missionControlSnapshotSchema } from '$lib/types/mission-control';

const airportRouteQuerySchema = z.object({});
const missionRouteQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    missionId: z.string().trim().min(1)
});

const airportRouteDataSchema = z.object({
    loginHref: z.string().trim().min(1),
    airportHome: airportHomeSnapshotSchema
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
export type MissionSnapshotBundle = z.infer<typeof missionSnapshotBundleSchema>;

async function buildMissionSnapshotBundle(input: {
    repositoryId: string;
    missionId: string;
}): Promise<MissionSnapshotBundle> {
    const path = await import('node:path');
    const { getMissionWorktreesPath } = await import('@flying-pillow/mission-core/node');
    const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
    const event = getRequestEvent();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
        repositoryId: input.repositoryId
    });
    const { missionId } = missionRuntimeRouteParamsSchema.parse({
        missionId: input.missionId
    });
    const gateway = new DaemonGateway(event.locals);
    const { EntityProxy } = await import('$lib/server/daemon/entity-proxy');
    const entityProxy = new EntityProxy(event.locals);
    const { airport, entities } = gateway;
    const airportHome = await airport.getHomeSnapshot();
    const repositorySnapshot = repositorySnapshotSchema.parse(await executeEntityQuery(entityProxy, {
        entity: 'Repository',
        method: 'read',
        payload: {
            repositoryId
        }
    }));
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
        repositorySnapshot: {
            ...repositorySnapshot,
            selectedMissionId: missionId,
            selectedMission: missionControl.missionRuntime
        },
        missionControl,
        missionWorktreePath,
        repositoryId,
        missionId
    });
}

export const getAirportRouteData = query(airportRouteQuerySchema, async () => {
    const event = getRequestEvent();
    const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
    const gateway = new DaemonGateway(event.locals);

    return airportRouteDataSchema.parse({
        loginHref: '/login?redirectTo=/airport',
        airportHome: await gateway.getAirportHomeSnapshot()
    });
});

export const logoutAirportSession = command(z.object({}), async () => {
    const event = getRequestEvent();
    const { clearGithubAuthSession } = await import('$lib/server/github-auth.server');
    await clearGithubAuthSession(event.cookies);
    event.locals.githubAuthToken = undefined;

    return airportLogoutResultSchema.parse({
        redirectTo: '/'
    });
});

export const readMissionSnapshotBundle = command(missionRouteQuerySchema, async (input) => {
    return await buildMissionSnapshotBundle(input);
});