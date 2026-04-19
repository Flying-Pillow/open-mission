// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts: Mission runtime snapshot endpoint backed by the thin Airport web gateway.
import { json } from '@sveltejs/kit';
import { missionRuntimeRouteParamsSchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.getMissionRuntimeSnapshot(missionId);

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};