// /apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts: Mission transport adapter for runtime snapshot and daemon event contracts.
import type {
    AirportRuntimeEventEnvelope,
    MissionRuntimeSnapshot
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
    parseAirportRuntimeEventEnvelope,
    parseMissionRuntimeSnapshot
} from '$lib/client/runtime/parsers';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

type EntityQueryExecutor = (input: EntityQueryInvocation) => Promise<EntityRemoteResult>;
const missionEntityName = 'Mission';

export class MissionRuntimeTransport extends EntityRuntimeTransport<
    string,
    MissionRuntimeSnapshot,
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
        this.queryRemote = input.queryRemote ?? qry;
    }

    public async getMissionRuntimeSnapshot(missionId: string): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime operation requires a non-empty id.');
        }

        return parseMissionRuntimeSnapshot(await this.queryRemote({
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
        return `/api/runtime/missions/${encodeURIComponent(missionId)}${this.buildQuerySuffix()}`;
    }

    protected buildEventsUrl(missionId: string): string {
        const query = new URLSearchParams({ missionId });
        if (this.repositoryRootPath) {
            query.set('repositoryRootPath', this.repositoryRootPath);
        }
        return `/api/runtime/events?${query.toString()}`;
    }

    protected parseSnapshot(value: unknown): MissionRuntimeSnapshot {
        return parseMissionRuntimeSnapshot(value);
    }

    protected parseEvent(value: unknown): AirportRuntimeEventEnvelope {
        return parseAirportRuntimeEventEnvelope(value);
    }

    protected getEntityLabel(): string {
        return 'Mission';
    }

    private buildQuerySuffix(): string {
        if (!this.repositoryRootPath) {
            return '';
        }

        const query = new URLSearchParams({
            repositoryRootPath: this.repositoryRootPath
        });
        return `?${query.toString()}`;
    }
}