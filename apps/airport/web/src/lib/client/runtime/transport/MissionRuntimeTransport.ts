// /apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts: Mission transport adapter for runtime snapshot and daemon event contracts.
import type {
    AirportRuntimeEventEnvelope,
    MissionSnapshot
} from '@flying-pillow/mission-core/schemas';
import type {
    EntityQueryInvocation,
    EntityRemoteResult
} from '@flying-pillow/mission-core/schemas';
import {
    EntityRuntimeTransport,
    type RuntimeSubscription
} from '$lib/client/runtime/transport/EntityRuntimeTransport';
import {
    parseAirportRuntimeEventEnvelope
} from '$lib/client/runtime/parsers';
import { missionSnapshotSchema } from '@flying-pillow/mission-core/schemas';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

type EntityQueryExecutor = (input: EntityQueryInvocation) => Promise<EntityRemoteResult>;
const missionEntityName = 'Mission';

export class MissionRuntimeTransport extends EntityRuntimeTransport<
    string,
    MissionSnapshot,
    AirportRuntimeEventEnvelope
> {
    private readonly repositoryRootPath?: string;
    private readonly queryRemote: EntityQueryExecutor;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: (url: string) => EventSource;
        repositoryRootPath?: string;
        queryRemote?: EntityQueryExecutor;
    } = {}) {
        super(input);
        this.repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
        this.queryRemote = input.queryRemote ?? ((queryInput) => qry(queryInput).run());
    }

    public async getMissionSnapshot(missionId: string): Promise<MissionSnapshot> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime operation requires a non-empty id.');
        }

        return missionSnapshotSchema.parse(await this.queryRemote({
            entity: missionEntityName,
            method: 'read',
            payload: {
                missionId: normalizedMissionId,
                ...(this.repositoryRootPath ? { repositoryRootPath: this.repositoryRootPath } : {})
            }
        }));
    }

    public observeMissionRuntime(input: {
        missionId: string;
        onEvent?: (event: AirportRuntimeEventEnvelope) => void | Promise<void>;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        return this.observe({
            id: input.missionId,
            onEvent: input.onEvent,
            onError: input.onError
        });
    }

    protected buildSnapshotUrl(missionId: string): string {
        throw new Error(`Mission '${missionId}' snapshots are loaded through the Mission entity query remote.`);
    }

    protected buildEventsUrl(missionId: string): string {
        const query = new URLSearchParams({ missionId });
        if (this.repositoryRootPath) {
            query.set('repositoryRootPath', this.repositoryRootPath);
        }
        return `/api/runtime/events?${query.toString()}`;
    }

    protected parseSnapshot(value: unknown): MissionSnapshot {
        return missionSnapshotSchema.parse(value);
    }

    protected parseEvent(value: unknown): AirportRuntimeEventEnvelope {
        return parseAirportRuntimeEventEnvelope(value);
    }

    protected getEntityLabel(): string {
        return 'Mission';
    }
}