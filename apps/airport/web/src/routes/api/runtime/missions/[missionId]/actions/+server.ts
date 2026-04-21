// /apps/airport/web/src/routes/api/runtime/missions/[missionId]/actions/+server.ts: Mission action projection and execution endpoint backed by daemon mission actions.
import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import {
    missionActionExecuteSchema,
    missionActionQuerySchema
} from './schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const query = missionActionQuerySchema.parse({
        repositoryId: url.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: url.searchParams.get('repositoryRootPath') ?? undefined,
        stageId: url.searchParams.get('stageId') ?? undefined,
        taskId: url.searchParams.get('taskId') ?? undefined,
        sessionId: url.searchParams.get('sessionId') ?? undefined,
    });
    const gateway = new AirportWebGateway(locals);
    const repository = query.repositoryRootPath
        ? { repositoryRootPath: query.repositoryRootPath }
        : query.repositoryId
            ? await gateway.resolveRepositoryCandidate({ repositoryId: query.repositoryId })
            : undefined;
    const snapshot = await gateway.getMissionActionSnapshot({
        missionId,
        context: query,
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const requestUrl = new URL(request.url);
    const repositoryId = requestUrl.searchParams.get('repositoryId')?.trim();
    const repositoryRootPath = requestUrl.searchParams.get('repositoryRootPath')?.trim();
    const body = missionActionExecuteSchema.parse(await request.json());
    const gateway = new AirportWebGateway(locals);
    const repository = repositoryRootPath
        ? { repositoryRootPath }
        : repositoryId
            ? await gateway.resolveRepositoryCandidate({ repositoryId })
            : undefined;
    const status = await gateway.executeMissionAction({
        missionId,
        actionId: body.actionId,
        ...(body.steps ? { steps: body.steps } : {}),
        ...(body.terminalSessionName
            ? { terminalSessionName: body.terminalSessionName }
            : {}),
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {}),
    });

    return json(status, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};