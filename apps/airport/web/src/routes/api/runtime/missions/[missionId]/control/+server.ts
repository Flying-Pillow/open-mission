import { json } from '@sveltejs/kit';
import { missionRuntimeRouteParamsSchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { MissionControlSnapshot } from '$lib/types/mission-control';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new AirportWebGateway(locals);

    const snapshot: MissionControlSnapshot = await gateway.entities.readMissionControl({
        missionId,
        ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};