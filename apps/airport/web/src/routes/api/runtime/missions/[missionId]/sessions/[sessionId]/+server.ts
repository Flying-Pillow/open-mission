// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/sessions/[sessionId]/+server.ts: Mission session command endpoint backed by daemon session control operations.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    missionRuntimeSessionCommandSchema
} from '@flying-pillow/mission-core';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
    const { missionId, sessionId } = missionRuntimeRouteParamsSchema.extend({
        sessionId: missionRuntimeRouteParamsSchema.shape.missionId
    }).parse(params);
    const body = missionRuntimeSessionCommandSchema.parse(await request.json());
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new DaemonGateway(locals);
    const snapshot = await gateway.executeMissionSessionCommand({
        missionId,
        sessionId,
        ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {}),
        ...body
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};