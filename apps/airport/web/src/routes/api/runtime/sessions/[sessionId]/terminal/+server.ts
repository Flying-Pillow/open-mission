// /apps/airport/web/src/routes/api/runtime/sessions/[sessionId]/terminal/+server.ts: Session terminal snapshot/input relay for xterm.js over Airport web runtime routes.
import { json } from '@sveltejs/kit';
import {
    missionSessionTerminalInputSchema,
    missionSessionTerminalQuerySchema,
    missionSessionTerminalRouteParamsSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { sessionId } = missionSessionTerminalRouteParamsSchema.parse(params);
    const query = missionSessionTerminalQuerySchema.parse({
        missionId: url.searchParams.get('missionId')
    });

    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.getMissionSessionTerminalSnapshot({
        missionId: query.missionId,
        sessionId
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { sessionId } = missionSessionTerminalRouteParamsSchema.parse(params);
    const body = missionSessionTerminalInputSchema.parse(await request.json());

    const gateway = new AirportWebGateway(locals);
    const snapshot = await gateway.sendMissionSessionTerminalInput({
        missionId: body.missionId,
        sessionId,
        data: body.data,
        ...(body.literal !== undefined ? { literal: body.literal } : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};
