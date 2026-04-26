import { json } from '@sveltejs/kit';
import { missionRuntimeRouteParamsSchema } from '@flying-pillow/mission-core/schemas';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { MissionControlSnapshot } from '$lib/types/mission-control';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new DaemonGateway(locals);

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