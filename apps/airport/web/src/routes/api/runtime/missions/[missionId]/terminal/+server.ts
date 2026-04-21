import { json } from '@sveltejs/kit';
import {
    missionRuntimeRouteParamsSchema,
    missionTerminalInputSchema
} from '@flying-pillow/mission-core';
import { z } from 'zod';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import {
    isStaleMissionTerminalDaemonError,
    resolveMissionTerminalRuntimeError,
    restartMissionTerminalDaemon
} from '$lib/server/mission-terminal-errors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
    const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
    const query = missionTerminalQuerySchema.parse({
        repositoryId: url.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: url.searchParams.get('repositoryRootPath') ?? undefined
    });

    try {
        const snapshot = await readMissionTerminalSnapshot(locals, missionId, query.repositoryId, query.repositoryRootPath);

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
    const body = missionTerminalInputSchema.parse(await request.json());

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

async function readMissionTerminalSnapshot(locals: App.Locals, missionId: string, repositoryId?: string, repositoryRootPath?: string) {
    const gateway = new AirportWebGateway(locals);
    const repository = repositoryRootPath
        ? { repositoryRootPath }
        : repositoryId
            ? await gateway.resolveRepositoryCandidate({ repositoryId })
            : undefined;
    try {
        return await gateway.getMissionTerminalSnapshot({
            missionId,
            ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
        });
    } catch (error) {
        if (!isStaleMissionTerminalDaemonError(error)) {
            throw error;
        }

        await restartMissionTerminalDaemon({ locals });
        return await new AirportWebGateway(locals).getMissionTerminalSnapshot({
            missionId,
            ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
        });
    }
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
    const gateway = new AirportWebGateway(locals);
    const repository = input.repositoryRootPath
        ? { repositoryRootPath: input.repositoryRootPath }
        : input.repositoryId
            ? await gateway.resolveRepositoryCandidate({ repositoryId: input.repositoryId })
            : undefined;
    try {
        return await gateway.sendMissionTerminalInput({
            ...input,
            ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
        });
    } catch (error) {
        if (!isStaleMissionTerminalDaemonError(error)) {
            throw error;
        }

        await restartMissionTerminalDaemon({ locals });
        return await new AirportWebGateway(locals).sendMissionTerminalInput({
            ...input,
            ...(repository ? { surfacePath: repository.repositoryRootPath } : {})
        });
    }
}