// /apps/airport/web/src/routes/repository/[repositoryId]/mission.remote.ts: Transitional repository mutation glue over the generic entity boundary.
import { command, form, getRequestEvent } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';
import {
    missionFromBriefInputSchema,
    missionFromIssueInputSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core/airport/runtime';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import {
    startMissionFromBriefThroughEntityBoundary,
    startMissionFromIssueThroughEntityBoundary
} from '../../api/entities/remote/dispatch';

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
        return await startMissionFromIssueThroughEntityBoundary(gateway, {
            repositoryId,
            issueNumber: input.issueNumber
        });
    }
);

export const startMissionFromBrief = form(
    missionFromBriefInputSchema,
    async (input): Promise<never> => {
        const { gateway, repositoryId } = resolveRepositoryContext();

        try {
            const result = await startMissionFromBriefThroughEntityBoundary(gateway, {
                repositoryId,
                brief: input
            });

            redirect(303, result.redirectTo);
        } catch (error) {
            invalid(
                error instanceof Error
                    ? error.message
                    : String(error)
            );
        }
    }
);
