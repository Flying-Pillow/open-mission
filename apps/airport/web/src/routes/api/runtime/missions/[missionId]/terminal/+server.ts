import { json } from '@sveltejs/kit';
import { MissionTerminalInputSchema } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { z } from 'zod';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import { resolveMissionTerminalRuntimeError } from '$lib/server/mission-terminal-errors';
import type { RequestHandler } from './$types';

const missionRuntimeRouteParamsSchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const query = missionTerminalQuerySchema.parse({
        repositoryId: url.searchParams.get('repositoryId') ?? undefined
    });

    try {
        const snapshot = await readMissionTerminalSnapshot(locals, missionId, query.repositoryId);

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
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined
    });
    const body = MissionTerminalInputSchema.parse(await request.json());

    try {
        const snapshot = await sendMissionTerminalInput(locals, {
            missionId,
            ...(body.data !== undefined ? { data: body.data } : {}),
            ...(body.literal !== undefined ? { literal: body.literal } : {}),
            ...(body.cols !== undefined ? { cols: body.cols } : {}),
            ...(body.rows !== undefined ? { rows: body.rows } : {}),
            ...(query.repositoryId ? { repositoryId: query.repositoryId } : {})
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
    repositoryId: z.string().trim().min(1).optional()
});

async function readMissionTerminalSnapshot(locals: App.Locals, missionId: string, repositoryId?: string) {
    const gateway = new DaemonGateway(locals);
    const repository = repositoryId
        ? await gateway.resolveRepositoryCandidate({ id: repositoryId })
        : undefined;
    return await gateway.getMissionTerminalSnapshot({
        missionId,
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
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
    }
) {
    const gateway = new DaemonGateway(locals);
    const repository = input.repositoryId
        ? await gateway.resolveRepositoryCandidate({ id: input.repositoryId })
        : undefined;
    return await gateway.sendMissionTerminalInput({
        ...input,
        ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
    });
}