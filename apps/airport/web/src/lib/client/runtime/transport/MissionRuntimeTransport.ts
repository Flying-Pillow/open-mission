// /apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts: Mission transport adapter for runtime snapshot and daemon event contracts.
import type {
    AirportRuntimeEventEnvelope,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/schemas';
import {
    EntityRuntimeTransport,
    type RuntimeSubscription
} from '$lib/client/runtime/transport/EntityRuntimeTransport';
import {
    parseAirportRuntimeEventEnvelope,
    parseMissionRuntimeSnapshot
} from '$lib/client/runtime/parsers';

export class MissionRuntimeTransport extends EntityRuntimeTransport<
    string,
    MissionRuntimeSnapshot,
    AirportRuntimeEventEnvelope
> {
    private readonly repositoryRootPath?: string;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: (url: string) => EventSource;
        repositoryRootPath?: string;
    } = {}) {
        super(input);
        this.repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    }

    public async getMissionRuntimeSnapshot(missionId: string): Promise<MissionRuntimeSnapshot> {
        return this.getSnapshot(missionId);
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