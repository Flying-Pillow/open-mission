// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/tasks/[taskId]/+server.ts: Mission task command endpoint backed by daemon mission action execution.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    missionRuntimeTaskCommandSchema
} from '@flying-pillow/mission-core/schemas';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
    const { missionId, taskId } = missionRuntimeRouteParamsSchema.extend({
        taskId: missionRuntimeRouteParamsSchema.shape.missionId
    }).parse(params);
    const body = missionRuntimeTaskCommandSchema.parse(await request.json());
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new DaemonGateway(locals);
    const snapshot = await gateway.executeMissionTaskCommand({
        missionId,
        taskId,
        action: body.action,
        ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {}),
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