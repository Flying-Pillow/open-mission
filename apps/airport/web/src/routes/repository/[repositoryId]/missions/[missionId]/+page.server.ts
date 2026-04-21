import path from 'node:path';
import { error as kitError } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { getMissionWorktreesPath } from '@flying-pillow/mission-core/node';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { MissionControlSnapshot } from '$lib/types/mission-control';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ locals, params }) => {
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse(params);
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);

    try {
        const gateway = new AirportWebGateway(locals);
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

        const snapshot: MissionControlSnapshot = missionControl;

        return {
            airportRepositories: airportHome.repositories,
            repositorySurface,
            missionControl: snapshot,
            missionWorktreePath,
            repositoryId,
            missionId,
        };
    } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        throw kitError(404, message);
    }
};