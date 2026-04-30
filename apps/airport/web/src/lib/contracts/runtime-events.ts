import type { AgentSessionSnapshot } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { EntityEventEnvelopeType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { MissionActionListSnapshot, MissionSnapshot, MissionStatusSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { MissionArtifactSnapshot } from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { MissionStageSnapshot } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import type { MissionTaskSnapshot } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { SystemSnapshot } from '@flying-pillow/mission-core/types';

export { EntityEventEnvelopeSchema as airportRuntimeEventEnvelopeSchema } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';

type AirportRuntimeEventBase = Omit<EntityEventEnvelopeType, 'type' | 'payload'>;

export type AirportRuntimeEventEnvelope = AirportRuntimeEventBase & (
    | {
        type: 'airport.state';
        payload: {
            system: SystemSnapshot;
        };
    }
    | {
        type: 'mission.snapshot.changed';
        payload: {
            snapshot: MissionSnapshot;
        };
    }
    | {
        type: 'mission.actions.changed';
        payload: {
            actions?: MissionActionListSnapshot;
        };
    }
    | {
        type: 'mission.status';
        payload: {
            status: MissionStatusSnapshot;
        };
    }
    | {
        type: 'stage.snapshot.changed';
        payload: {
            snapshot: MissionStageSnapshot;
        };
    }
    | {
        type: 'task.snapshot.changed';
        payload: {
            snapshot: MissionTaskSnapshot;
        };
    }
    | {
        type: 'artifact.snapshot.changed';
        payload: {
            snapshot: MissionArtifactSnapshot;
        };
    }
    | {
        type: 'agentSession.snapshot.changed';
        payload: {
            snapshot: AgentSessionSnapshot;
        };
    }
    | {
        type: 'session.event';
        payload: {
            session: AgentSessionSnapshot;
        };
    }
    | {
        type: 'session.lifecycle';
        payload: unknown;
    }
);
