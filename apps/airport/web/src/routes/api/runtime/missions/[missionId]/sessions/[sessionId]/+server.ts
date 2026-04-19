// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/sessions/[sessionId]/+server.ts: Mission session command endpoint backed by daemon session control operations.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    missionRuntimeSessionCommandSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { missionId, sessionId } = missionRuntimeRouteParamsSchema.extend({
        sessionId: missionRuntimeRouteParamsSchema.shape.missionId
    }).parse(params);
    const body = missionRuntimeSessionCommandSchema.parse(await request.json());
    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.executeMissionSessionCommand({
        missionId,
        sessionId,
        ...body
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};