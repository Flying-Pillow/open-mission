import path from 'node:path';
import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema,
} from '@flying-pillow/mission-core';
import { getMissionWorktreesPath } from '@flying-pillow/mission-core/node';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { MissionControlSnapshot } from '$lib/types/mission-control';

const missionDataQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
});

export const getMissionData = query(
    missionDataQuerySchema,
    async (input) => {
        const event = getRequestEvent();
        const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
            repositoryId: input.repositoryId,
        });
        const { missionId } = missionRuntimeRouteParamsSchema.parse({
            missionId: input.missionId,
        });
        const gateway = new AirportWebGateway(event.locals);
        const airportHome = await gateway.getAirportHomeSnapshot();
        const repositorySurface = await gateway.getRepositorySurfaceSnapshot({
            repositoryId,
            selectedMissionId: missionId,
        });
        const missionWorktreePath = path.join(
            getMissionWorktreesPath(repositorySurface.repository.repositoryRootPath),
            missionId,
        );
        const missionControl: MissionControlSnapshot =
            await gateway.getMissionControlSnapshot({
                missionId,
                surfacePath: missionWorktreePath,
            });

        return {
            airportRepositories: airportHome.repositories,
            repositorySurface,
            missionControl,
            missionWorktreePath,
            repositoryId,
            missionId,
        };
    },
);