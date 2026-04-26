import { getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema,
} from '@flying-pillow/mission-core/schemas';
import type { MissionControlSnapshot } from '$lib/types/mission-control';

const missionDataQuerySchema = z.object({
    repositoryId: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
});

export const getMissionData = query(
    missionDataQuerySchema,
    async (input) => {
        const path = await import('node:path');
        const { getMissionWorktreesPath } = await import('@flying-pillow/mission-core/node');
        const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
        const event = getRequestEvent();
        const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse({
            repositoryId: input.repositoryId,
        });
        const { missionId } = missionRuntimeRouteParamsSchema.parse({
            missionId: input.missionId,
        });
        const gateway = new DaemonGateway(event.locals);
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