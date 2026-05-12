export const MISSION_LIFECYCLE_STATES = [
    'draft',
    'ready',
    'running',
    'paused',
    'completed',
    'delivered'
] as const;

export const MISSION_STAGE_DERIVED_STATES = [
    'pending',
    'ready',
    'running',
    'completed'
] as const;

export const MISSION_TASK_LIFECYCLE_STATES = [
    'pending',
    'ready',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled'
] as const;

export const MISSION_AGENT_EXECUTION_LIFECYCLE_STATES = [
    'starting',
    'running',
    'completed',
    'failed',
    'cancelled',
    'terminated'
] as const;

export const DEFAULT_TASK_MAX_REWORK_ITERATIONS = 3;
