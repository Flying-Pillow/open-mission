// /apps/airport/web/src/lib/client/runtime/AirportClientRuntime.ts: Root browser runtime that composes mission runtime transport, entity cache, and live mission observation.
import type {
    AirportRuntimeEventEnvelope,
    MissionSnapshot
} from '@flying-pillow/mission-core/schemas';
import { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';
import { EntityRuntimeStore } from '$lib/client/runtime/EntityRuntimeStore';
import { ChildEntityCommandTransport } from '$lib/client/runtime/transport/ChildEntityCommandTransport';
import { MissionCommandTransport } from '$lib/client/runtime/transport/MissionCommandTransport';
import { MissionRuntimeTransport } from '$lib/client/runtime/transport/MissionRuntimeTransport';
import type { RuntimeSubscription } from '$lib/client/runtime/transport/EntityRuntimeTransport';

type EventSourceFactory = (url: string) => EventSource;

export class AirportClientRuntime {
    private readonly missionTransport: MissionRuntimeTransport;
    private readonly missionCommands: MissionCommandTransport;
    private readonly childEntityCommands: ChildEntityCommandTransport;
    private readonly missions: EntityRuntimeStore<string, MissionSnapshot, Mission>;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
        repositoryRootPath?: string;
    } = {}) {
        this.missionTransport = new MissionRuntimeTransport(input);
        this.missionCommands = new MissionCommandTransport(input);
        this.childEntityCommands = new ChildEntityCommandTransport(input);
        this.missions = new EntityRuntimeStore({
            loadSnapshot: (missionId) => this.missionTransport.getMissionSnapshot(missionId),
            createEntity: (snapshot, loadSnapshot) => new Mission(snapshot, loadSnapshot, this.missionCommands, this.childEntityCommands),
            selectId: (snapshot) => snapshot.mission.missionId
        });
    }

    public async getMission(missionId: string): Promise<Mission> {
        return this.missions.get(missionId);
    }

    public hydrateMissionSnapshot(snapshot: MissionSnapshot): Mission {
        return this.missions.upsertSnapshot(snapshot);
    }

    public async refreshMission(missionId: string): Promise<Mission> {
        const snapshot = await this.missionTransport.getMissionSnapshot(missionId);
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