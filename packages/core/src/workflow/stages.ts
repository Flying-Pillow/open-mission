export const MISSION_STAGE_IDS = ['prd', 'spec', 'implementation', 'audit', 'delivery'] as const;

export type MissionStageId = (typeof MISSION_STAGE_IDS)[number];
