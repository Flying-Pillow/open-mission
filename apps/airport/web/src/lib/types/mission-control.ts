import type { MissionRuntimeSnapshot } from '@flying-pillow/mission-core/airport/runtime';
import type { OperatorStatus } from '@flying-pillow/mission-core/types.js';

export type MissionControlSnapshot = {
    missionRuntime: MissionRuntimeSnapshot;
    operatorStatus: OperatorStatus;
};