// /apps/airport/web/src/routes/api/runtime/sessions/[sessionId]/terminal/+server.ts: Session terminal snapshot/input relay for xterm.js over Airport web runtime routes.
import { json } from '@sveltejs/kit';
import { AgentSessionTerminalInputSchema as missionSessionTerminalInputSchema, AgentSessionTerminalQuerySchema as missionSessionTerminalQuerySchema, AgentSessionTerminalRouteParamsSchema as missionSessionTerminalRouteParamsSchema } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { sessionId } = missionSessionTerminalRouteParamsSchema.parse(params);
    const query = missionSessionTerminalQueryWithRepositorySchema.parse({
        missionId: url.searchParams.get('missionId'),
        repositoryId: url.searchParams.get('repositoryId') ?? undefined
    });

    const gateway = new DaemonGateway(locals);
    const repository = query.repositoryId
        ? await gateway.resolveRepositoryCandidate({ id: query.repositoryId })
        : undefined;
    const snapshot = await gateway.getMissionSessionTerminalSnapshot({
        missionId: query.missionId,
        sessionId,
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { sessionId } = missionSessionTerminalRouteParamsSchema.parse(params);
    const requestUrl = new URL(request.url);
    const query = missionSessionTerminalQueryWithRepositorySchema.parse({
        missionId: requestUrl.searchParams.get('missionId'),
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined
    });
    const body = missionSessionTerminalInputSchema.parse(await request.json());

    const gateway = new DaemonGateway(locals);
    const repository = query.repositoryId
        ? await gateway.resolveRepositoryCandidate({ id: query.repositoryId })
        : undefined;
    const snapshot = await gateway.sendMissionSessionTerminalInput({
        missionId: body.missionId,
        sessionId,
        ...(body.data !== undefined ? { data: body.data } : {}),
        ...(body.literal !== undefined ? { literal: body.literal } : {}),
        ...(body.cols !== undefined ? { cols: body.cols } : {}),
        ...(body.rows !== undefined ? { rows: body.rows } : {}),
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
    });

    return json(snapshot, {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

const missionSessionTerminalQueryWithRepositorySchema = missionSessionTerminalQuerySchema.extend({
    repositoryId: missionSessionTerminalQuerySchema.shape.missionId.optional()
});
