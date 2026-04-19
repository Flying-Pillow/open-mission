// /apps/airport/web/src/routes/repository/[repositoryId]/mission.remote.ts: Remote mutations for creating repository missions from issues and authored briefs.
import { command, form, getRequestEvent } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';
import {
    missionFromBriefInputSchema,
    missionFromIssueInputSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';

function resolveRepositoryContext(): {
    gateway: AirportWebGateway;
    repositoryId: string;
} {
    const event = getRequestEvent();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse(event.params);

    return {
        gateway: new AirportWebGateway(event.locals),
        repositoryId
    };
}

export const startMissionFromIssue = command(
    missionFromIssueInputSchema,
    async (input): Promise<{ missionId: string; redirectTo: string }> => {
        const { gateway, repositoryId } = resolveRepositoryContext();
        const status = await gateway.createMissionFromIssue({
            repositoryId,
            issueNumber: input.issueNumber
        });

        if (!status.missionId) {
            throw new Error('Mission creation did not return a missionId.');
        }

        return {
            missionId: status.missionId,
            redirectTo: `/repository/${encodeURIComponent(repositoryId)}?missionId=${encodeURIComponent(status.missionId)}`
        };
    }
);

export const startMissionFromBrief = form(
    missionFromBriefInputSchema,
    async (input): Promise<never> => {
        const { gateway, repositoryId } = resolveRepositoryContext();

        try {
            const status = await gateway.createMissionFromBrief({
                repositoryId,
                brief: input
            });

            if (!status.missionId) {
                throw new Error('Mission creation did not return a missionId.');
            }

            redirect(303, `/repository/${encodeURIComponent(repositoryId)}?missionId=${encodeURIComponent(status.missionId)}`);
        } catch (error) {
            invalid(
                error instanceof Error
                    ? error.message
                    : String(error)
            );
        }
    }
);