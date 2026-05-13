import { json } from '@sveltejs/kit';
import { MissionTerminalInputSchema } from '@flying-pillow/open-mission-core/entities/Terminal/MissionTerminalSchema';
import { z } from 'zod';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import { resolveMissionTerminalRuntimeError } from '$lib/server/mission-terminal-errors';
import { resolveRepositoryRootPath } from '$lib/server/repository-root-path.server';
import type { RequestHandler } from './$types';

const missionRuntimeRouteParamsSchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const query = missionTerminalQuerySchema.parse({
        repositoryId: url.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: url.searchParams.get('repositoryRootPath') ?? undefined
    });

    try {
        const snapshot = await readMissionTerminalSnapshot(locals, missionId, query);

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
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const requestUrl = new URL(request.url);
    const query = missionTerminalQuerySchema.parse({
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: requestUrl.searchParams.get('repositoryRootPath') ?? undefined
    });
    const body = MissionTerminalInputSchema.parse(await request.json());

    try {
        const snapshot = await sendMissionTerminalInput(locals, {
            missionId,
            ...(body.data !== undefined ? { data: body.data } : {}),
            ...(body.literal !== undefined ? { literal: body.literal } : {}),
            ...(body.cols !== undefined ? { cols: body.cols } : {}),
            ...(body.rows !== undefined ? { rows: body.rows } : {}),
            ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
            ...(query.repositoryRootPath ? { repositoryRootPath: query.repositoryRootPath } : {})
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

const missionTerminalQuerySchema = z.object({
    repositoryId: z.string().trim().min(1).optional(),
    repositoryRootPath: z.string().trim().min(1).optional()
});

async function readMissionTerminalSnapshot(locals: App.Locals, missionId: string, query: z.infer<typeof missionTerminalQuerySchema>) {
    const gateway = new DaemonGateway(locals);
    const surfacePath = await resolveRepositoryRootPath({
        locals,
        repositoryId: query.repositoryId,
        repositoryRootPath: query.repositoryRootPath
    });
    return await gateway.getMissionTerminalSnapshot({
        missionId,
        ...(surfacePath ? { surfacePath } : {})
    });
}


async function sendMissionTerminalInput(
    locals: App.Locals,
    input: {
        missionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        repositoryId?: string;
        repositoryRootPath?: string;
    }
) {
    const gateway = new DaemonGateway(locals);
    const surfacePath = await resolveRepositoryRootPath({
        locals,
        repositoryId: input.repositoryId,
        repositoryRootPath: input.repositoryRootPath
    });
    return await gateway.sendMissionTerminalInput({
        ...input,
        ...(surfacePath ? { surfacePath } : {})
    });
}
