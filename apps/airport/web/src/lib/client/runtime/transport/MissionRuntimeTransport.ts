// /apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts: Mission transport adapter for runtime snapshot and daemon event contracts.
import {
    airportRuntimeEventEnvelopeSchema,
    missionRuntimeSnapshotDtoSchema,
    type AirportRuntimeEventEnvelopeDto,
    type MissionRuntimeSnapshotDto
} from '@flying-pillow/mission-core/airport/runtime';
import {
    EntityRuntimeTransport,
    type RuntimeSubscription
} from '$lib/client/runtime/transport/EntityRuntimeTransport';

export class MissionRuntimeTransport extends EntityRuntimeTransport<
    string,
    MissionRuntimeSnapshotDto,
    AirportRuntimeEventEnvelopeDto
> {
    public async getMissionRuntimeSnapshot(missionId: string): Promise<MissionRuntimeSnapshotDto> {
        return this.getSnapshot(missionId);
    }

    public observeMissionRuntime(input: {
        missionId: string;
        onEvent?: (event: AirportRuntimeEventEnvelopeDto) => void | Promise<void>;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        return this.observe({
            id: input.missionId,
            onEvent: input.onEvent,
            onError: input.onError
        });
    }

    protected buildSnapshotUrl(missionId: string): string {
        return `/api/runtime/missions/${encodeURIComponent(missionId)}`;
    }

    protected buildEventsUrl(missionId: string): string {
        return `/api/runtime/events?missionId=${encodeURIComponent(missionId)}`;
    }

    protected parseSnapshot(value: unknown): MissionRuntimeSnapshotDto {
        return missionRuntimeSnapshotDtoSchema.parse(value);
    }

    protected parseEvent(value: unknown): AirportRuntimeEventEnvelopeDto {
        return airportRuntimeEventEnvelopeSchema.parse(value);
    }

    protected getEntityLabel(): string {
        return 'Mission';
    }
}