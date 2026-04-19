// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/actions/+server.ts: Mission-level command endpoint backed by daemon mission action execution.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeMissionCommandSchema,
    missionRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const body = missionRuntimeMissionCommandSchema.parse(await request.json());
    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.executeMissionCommand({
        missionId,
        action: body.action
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};