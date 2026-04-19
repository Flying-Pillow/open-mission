// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/tasks/[taskId]/+server.ts: Mission task command endpoint backed by daemon mission action execution.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    missionRuntimeTaskCommandSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { missionId, taskId } = missionRuntimeRouteParamsSchema.extend({
        taskId: missionRuntimeRouteParamsSchema.shape.missionId
    }).parse(params);
    const body = missionRuntimeTaskCommandSchema.parse(await request.json());
    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.executeMissionTaskCommand({
        missionId,
        taskId,
        action: body.action,
        ...(body.action === 'start' && body.terminalSessionName
            ? { terminalSessionName: body.terminalSessionName }
            : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};