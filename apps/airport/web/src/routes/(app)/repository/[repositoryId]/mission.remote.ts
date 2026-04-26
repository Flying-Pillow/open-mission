// /apps/airport/web/src/routes/repository/[repositoryId]/mission.remote.ts: Transitional repository mutation glue over the generic entity boundary.
import { command, getRequestEvent } from '$app/server';
import {
    missionFromBriefInputSchema,
    missionFromIssueInputSchema,
    repositoryRuntimeRouteParamsSchema
} from '@flying-pillow/mission-core/airport/runtime';
import { executeEntityCommand } from '../../../api/entities/remote/dispatch';
import { repositoryMissionMutationStatusSchema } from '@flying-pillow/mission-core/entities/Repository/RepositoryRemote';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

async function resolveRepositoryContext(): Promise<{
    gateway: EntityProxy;
    repositoryId: string;
}> {
    const event = getRequestEvent();
    const { repositoryId } = repositoryRuntimeRouteParamsSchema.parse(event.params);

    return {
        gateway: new EntityProxy(event.locals),
        repositoryId
    };
}

export const startMissionFromIssue = command(
    missionFromIssueInputSchema,
    async (input): Promise<{ missionId: string; redirectTo: string }> => {
        const { gateway, repositoryId } = await resolveRepositoryContext();
        const result = repositoryMissionMutationStatusSchema.parse(await executeEntityCommand(gateway, {
            entity: 'Repository',
            method: 'startMissionFromIssue',
            payload: {
                repositoryId,
                issueNumber: input.issueNumber
            }
        }));

        return {
            missionId: result.missionId,
            redirectTo: `/repository/${encodeURIComponent(repositoryId)}/missions/${encodeURIComponent(result.missionId)}`
        };
    }
);

export const startMissionFromBrief = command(
    missionFromBriefInputSchema,
    async (input): Promise<{ missionId: string; redirectTo: string }> => {
        const { gateway, repositoryId } = await resolveRepositoryContext();
        const result = repositoryMissionMutationStatusSchema.parse(await executeEntityCommand(gateway, {
            entity: 'Repository',
            method: 'startMissionFromBrief',
            payload: {
                repositoryId,
                ...input
            }
        }));

        return {
            missionId: result.missionId,
            redirectTo: `/repository/${encodeURIComponent(repositoryId)}/missions/${encodeURIComponent(result.missionId)}`
        };
    }
);
