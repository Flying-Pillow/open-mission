// /apps/airport/web/src/lib/client/runtime/AirportClientRuntime.ts: Root browser runtime that composes mission runtime transport, entity cache, and live mission observation.
import type {
    AirportRuntimeEventEnvelope,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/schemas';
import { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';
import { EntityRuntimeStore } from '$lib/client/runtime/EntityRuntimeStore';
import { MissionCommandTransport } from '$lib/client/runtime/transport/MissionCommandTransport';
import { MissionRuntimeTransport } from '$lib/client/runtime/transport/MissionRuntimeTransport';
import type { RuntimeSubscription } from '$lib/client/runtime/transport/EntityRuntimeTransport';

type EventSourceFactory = (url: string) => EventSource;

export class AirportClientRuntime {
    private readonly missionTransport: MissionRuntimeTransport;
    private readonly missionCommands: MissionCommandTransport;
    private readonly missions: EntityRuntimeStore<string, MissionRuntimeSnapshot, Mission>;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
        repositoryRootPath?: string;
    } = {}) {
        this.missionTransport = new MissionRuntimeTransport(input);
        this.missionCommands = new MissionCommandTransport(input);
        this.missions = new EntityRuntimeStore({
            loadSnapshot: (missionId) => this.missionTransport.getMissionRuntimeSnapshot(missionId),
            createEntity: (snapshot, loadSnapshot) => new Mission(snapshot, loadSnapshot, this.missionCommands),
            selectId: (snapshot) => snapshot.missionId
        });
    }

    public async getMission(missionId: string): Promise<Mission> {
        return this.missions.get(missionId);
    }

    public hydrateMissionSnapshot(snapshot: MissionRuntimeSnapshot): Mission {
        return this.missions.upsertSnapshot(snapshot);
    }

    public async refreshMission(missionId: string): Promise<Mission> {
        const snapshot = await this.missionTransport.getMissionRuntimeSnapshot(missionId);
        return this.hydrateMissionSnapshot(snapshot);
    }

    public observeMission(input: {
        missionId: string;
        onUpdate?: (mission: Mission, event: AirportRuntimeEventEnvelope) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        return this.missionTransport.observeMissionRuntime({
            missionId: input.missionId,
            onEvent: async (event) => {
                const mission = await this.getMission(input.missionId);
                input.onUpdate?.(mission, event);
            },
            onError: input.onError
        });
    }
}