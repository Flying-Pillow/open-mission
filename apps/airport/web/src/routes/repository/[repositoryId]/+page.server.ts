// /apps/airport/web/src/routes/repository/[repositoryId]/+page.server.ts: Loads repository-scoped mission data and handles mission selection redirects.
import { error as kitError, redirect, type Actions } from '@sveltejs/kit';
import {
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { logAirportWebPerf } from '$lib/server/daemon.server';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ locals, params, url }) => {
    const startedAt = performance.now();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse(params);
    const missionId = url.searchParams.get('missionId')?.trim() || undefined;

    try {
        const gateway = new AirportWebGateway(locals);

        return {
            repositorySurface: await gateway.getRepositorySurfaceSnapshot({
                repositoryId,
                repositoryRootPath: repositoryId,
                ...(missionId ? { selectedMissionId: missionId } : {})
            })
        };
    } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        throw kitError(404, message);
    } finally {
        logAirportWebPerf('route.repositoryPage.load', startedAt, {
            repositoryId,
            selectedMissionId: missionId
        });
    }
};

export const actions: Actions = {
    selectMission: async ({ params, request }) => {
        const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse(params);
        const formData = await request.formData();
        const missionId = String(formData.get('missionId') ?? '').trim();
        throw redirect(303, missionId ? `/repository/${encodeURIComponent(repositoryId)}?missionId=${encodeURIComponent(missionId)}` : `/repository/${encodeURIComponent(repositoryId)}`);
    }
};