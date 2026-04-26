// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts: Mission runtime snapshot endpoint backed by the thin Airport web gateway.
import { json } from '@sveltejs/kit';
import { missionRuntimeRouteParamsSchema } from '@flying-pillow/mission-core';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new DaemonGateway(locals);
    const snapshot = await gateway.entities.readMissionRuntime(missionId, repositoryRootPath);

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};