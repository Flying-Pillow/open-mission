// /apps/airport/web/src/routes/api/runtime/agent-executions/[agentExecutionId]/terminal/+server.ts: AgentExecution terminal snapshot/input relay over Airport web runtime routes.
import { json } from '@sveltejs/kit';
import { AgentExecutionTerminalRouteInputSchema as agentExecutionTerminalInputSchema, AgentExecutionTerminalRouteQuerySchema as agentExecutionTerminalQuerySchema, AgentExecutionTerminalRouteParamsSchema as agentExecutionTerminalRouteParamsSchema } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import { resolveMissionTerminalRuntimeError } from '$lib/server/mission-terminal-errors';
import { resolveRepositoryRootPath } from '$lib/server/repository-root-path.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { agentExecutionId } = agentExecutionTerminalRouteParamsSchema.parse(params);
    const query = agentExecutionTerminalQueryWithRepositorySchema.parse({
        ownerId: url.searchParams.get('ownerId'),
        repositoryId: url.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: url.searchParams.get('repositoryRootPath') ?? undefined
    });

    const gateway = new DaemonGateway(locals);
    try {
        const surfacePath = await resolveRepositoryRootPath({
            locals,
            repositoryId: query.repositoryId,
            repositoryRootPath: query.repositoryRootPath
        });
        const snapshot = await gateway.getAgentExecutionTerminalSnapshot({
            ownerId: query.ownerId,
            agentExecutionId,
            ...(surfacePath ? { surfacePath } : {})
        });

        return json(snapshot, {
            headers: {
                'cache-control': 'no-store'
            }
        });
    } catch (error) {
        const runtimeError = resolveMissionTerminalRuntimeError(error);
        return json({ message: runtimeError.message }, {
            status: runtimeError.status,
            headers: {
                'cache-control': 'no-store'
            }
        });
    }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
    const { agentExecutionId } = agentExecutionTerminalRouteParamsSchema.parse(params);
    const requestUrl = new URL(request.url);
    const query = agentExecutionTerminalQueryWithRepositorySchema.parse({
        ownerId: requestUrl.searchParams.get('ownerId'),
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: requestUrl.searchParams.get('repositoryRootPath') ?? undefined
    });
    const body = agentExecutionTerminalInputSchema.parse(await request.json());

    const gateway = new DaemonGateway(locals);
    try {
        const surfacePath = await resolveRepositoryRootPath({
            locals,
            repositoryId: query.repositoryId,
            repositoryRootPath: query.repositoryRootPath
        });
        const snapshot = await gateway.sendAgentExecutionTerminalInput({
            ownerId: body.ownerId,
            agentExecutionId,
            ...(body.data !== undefined ? { data: body.data } : {}),
            ...(body.literal !== undefined ? { literal: body.literal } : {}),
            ...(body.cols !== undefined ? { cols: body.cols } : {}),
            ...(body.rows !== undefined ? { rows: body.rows } : {}),
            ...(surfacePath ? { surfacePath } : {})
        });

        return json(snapshot, {
            headers: {
                'cache-control': 'no-store'
            }
        });
    } catch (error) {
        const runtimeError = resolveMissionTerminalRuntimeError(error);
        return json({ message: runtimeError.message }, {
            status: runtimeError.status,
            headers: {
                'cache-control': 'no-store'
            }
        });
    }
};

const agentExecutionTerminalQueryWithRepositorySchema = agentExecutionTerminalQuerySchema.extend({
    repositoryId: agentExecutionTerminalQuerySchema.shape.ownerId.optional(),
    repositoryRootPath: agentExecutionTerminalQuerySchema.shape.ownerId.optional()
});