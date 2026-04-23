// /apps/airport/web/src/lib/client/runtime/AirportClientRuntime.ts: Root browser runtime that composes mission runtime transport, entity cache, and live mission observation.
import type {
    AirportRuntimeEventEnvelope,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/airport/runtime';
import { Mission } from '$lib/client/entities/Mission';
import {
    createEntityRuntimeClient,
    type EntityRuntimeClient
} from '$lib/client/runtime/RuntimeClientFactory';
import { MissionCommandTransport } from '$lib/client/runtime/transport/MissionCommandTransport';
import { MissionRuntimeTransport } from '$lib/client/runtime/transport/MissionRuntimeTransport';

type EventSourceFactory = (url: string) => EventSource;

export class AirportClientRuntime {
    private readonly missions: EntityRuntimeClient<
        string,
        MissionRuntimeSnapshot,
        Mission,
        AirportRuntimeEventEnvelope
    >;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
    } = {}) {
        const missionTransport = new MissionRuntimeTransport(input);
        const missionCommands = new MissionCommandTransport(input);
        this.missions = createEntityRuntimeClient({
            transport: missionTransport,
            createEntity: (snapshot, loadSnapshot) => new Mission(snapshot, loadSnapshot, missionCommands),
            selectEntityId: (snapshot) => snapshot.missionId
        });
    }

    public async getMission(missionId: string): Promise<Mission> {
        return this.missions.get(missionId);
    }

    public observeMission(input: {
        missionId: string;
        onUpdate?: (mission: Mission, event: AirportRuntimeEventEnvelope) => void;
        onError?: (error: Error) => void;
    }): { dispose(): void } {
        return this.missions.observe({
            id: input.missionId,
            onUpdate: input.onUpdate,
            onError: input.onError
        });
    }
}