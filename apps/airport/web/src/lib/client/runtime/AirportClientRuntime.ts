// /apps/airport/web/src/lib/client/runtime/AirportClientRuntime.ts: Browser runtime that hydrates Mission entities from Airport web runtime endpoints and SSE events.
import {
    airportRuntimeEventEnvelopeSchema,
    missionRuntimeSnapshotDtoSchema,
    type AirportRuntimeEventEnvelopeDto,
    type MissionRuntimeSnapshotDto
} from '@flying-pillow/mission-core';
import { Mission } from '$lib/client/entities/Mission';
import { EntityRuntimeStore } from '$lib/client/runtime/EntityRuntimeStore';

type EventSourceFactory = (url: string) => EventSource;

export class AirportClientRuntime {
    private readonly fetcher: typeof fetch;
    private readonly createEventSource: EventSourceFactory;
    private readonly missions: EntityRuntimeStore<string, MissionRuntimeSnapshotDto, Mission>;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
    } = {}) {
        this.fetcher = input.fetch ?? fetch;
        this.createEventSource = input.createEventSource ?? ((url) => new EventSource(url));
        this.missions = new EntityRuntimeStore({
            loadSnapshot: async (missionId) => this.fetchMissionSnapshot(missionId),
            createEntity: (snapshot, loadSnapshot) => new Mission(snapshot, loadSnapshot),
            selectId: (snapshot) => snapshot.missionId
        });
    }

    public async getMission(missionId: string): Promise<Mission> {
        return this.missions.get(missionId);
    }

    public subscribeToMission(input: {
        missionId: string;
        onUpdate?: (mission: Mission, event: AirportRuntimeEventEnvelopeDto) => void;
        onError?: (error: Error) => void;
    }): { dispose(): void } {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission subscription requires a missionId.');
        }

        const eventSource = this.createEventSource(`/api/runtime/events?missionId=${encodeURIComponent(missionId)}`);
        const handleRuntimeEvent = (event: Event) => {
            const messageEvent = event as MessageEvent<string>;
            void (async () => {
                try {
                    const envelope = airportRuntimeEventEnvelopeSchema.parse(JSON.parse(messageEvent.data));
                    const mission = await this.missions.refresh(missionId);
                    input.onUpdate?.(mission, envelope);
                } catch (error) {
                    input.onError?.(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        };

        const handleError = () => {
            input.onError?.(new Error(`Mission runtime event stream failed for '${missionId}'.`));
        };

        eventSource.addEventListener('runtime', handleRuntimeEvent as EventListener);
        eventSource.addEventListener('error', handleError as EventListener);

        return {
            dispose: () => {
                eventSource.removeEventListener('runtime', handleRuntimeEvent as EventListener);
                eventSource.removeEventListener('error', handleError as EventListener);
                eventSource.close();
            }
        };
    }

    private async fetchMissionSnapshot(missionId: string): Promise<MissionRuntimeSnapshotDto> {
        const response = await this.fetcher(`/api/runtime/missions/${encodeURIComponent(missionId)}`, {
            headers: {
                accept: 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Mission runtime fetch failed for '${missionId}' (${response.status}).`);
        }

        return missionRuntimeSnapshotDtoSchema.parse(await response.json());
    }
}