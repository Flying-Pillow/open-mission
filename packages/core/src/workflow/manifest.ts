import {
    MISSION_STAGE_DERIVED_STATES,
    type MissionStageDerivedState,
    type MissionTaskLifecycleState
} from './engine/types.js';
import { MISSION_STAGE_IDS, type MissionStageId } from './stages.js';

export type { MissionStageId };

export type MissionWorkflowTaskStatus = MissionTaskLifecycleState;
export type MissionTaskStatusIntent = 'start' | 'done' | 'reopen';
export type MissionStageStatusIntent = 'start' | 'restart';

export type MissionArtifactKey = 'brief' | 'prd' | 'spec' | 'verify' | 'audit' | 'delivery';

export type MissionStageProgress = MissionStageDerivedState;

export type MissionTaskPairingDefinition = {
    enabled: true;
    executionTaskKind: 'implementation';
    verificationTaskKind: 'verification';
    verificationStageId: 'implementation';
    verificationFileNamePrefix: 'verify-';
    verificationDependsOnExecution: true;
    verificationArtifactKey: 'verify';
};

export type MissionStageDefinition = {
    id: MissionStageId;
    stageFolder: string;
    artifacts: MissionArtifactKey[];
    taskPairing?: MissionTaskPairingDefinition;
};

export type MissionArtifactDefinition = {
    key: MissionArtifactKey;
    label: string;
    fileName: string;
    stageId?: MissionStageId;
};

export const WORKFLOW_STAGE_DEFINITIONS: readonly MissionStageDefinition[] = [
    {
        id: 'prd',
        stageFolder: '01-PRD',
        artifacts: ['prd']
    },
    {
        id: 'spec',
        stageFolder: '02-SPEC',
        artifacts: ['spec']
    },
    {
        id: 'implementation',
        stageFolder: '03-IMPLEMENTATION',
        artifacts: ['verify'],
        taskPairing: {
            enabled: true,
            executionTaskKind: 'implementation',
            verificationTaskKind: 'verification',
            verificationStageId: 'implementation',
            verificationFileNamePrefix: 'verify-',
            verificationDependsOnExecution: true,
            verificationArtifactKey: 'verify'
        }
    },
    {
        id: 'audit',
        stageFolder: '04-AUDIT',
        artifacts: ['audit']
    },
    {
        id: 'delivery',
        stageFolder: '05-DELIVERY',
        artifacts: ['delivery']
    }
] as const;

export const WORKFLOW_ARTIFACT_DEFINITIONS: Readonly<Record<MissionArtifactKey, MissionArtifactDefinition>> = {
    brief: {
        key: 'brief',
        label: 'Brief',
        fileName: 'BRIEF.md'
    },
    prd: {
        key: 'prd',
        label: 'Requirements',
        fileName: 'PRD.md',
        stageId: 'prd'
    },
    spec: {
        key: 'spec',
        label: 'Specification',
        fileName: 'SPEC.md',
        stageId: 'spec'
    },
    verify: {
        key: 'verify',
        label: 'Verification',
        fileName: 'VERIFY.md',
        stageId: 'implementation'
    },
    audit: {
        key: 'audit',
        label: 'Audit',
        fileName: 'AUDIT.md',
        stageId: 'audit'
    },
    delivery: {
        key: 'delivery',
        label: 'Delivery',
        fileName: 'DELIVERY.md',
        stageId: 'delivery'
    }
};

export const MISSION_STAGES: readonly MissionStageId[] = [...MISSION_STAGE_IDS];

export const MISSION_ARTIFACT_KEYS: readonly MissionArtifactKey[] = Object.keys(
    WORKFLOW_ARTIFACT_DEFINITIONS
) as MissionArtifactKey[];

export const MISSION_ARTIFACT_LABELS: Readonly<Record<MissionArtifactKey, string>> = Object.fromEntries(
    MISSION_ARTIFACT_KEYS.map((key) => [key, WORKFLOW_ARTIFACT_DEFINITIONS[key].label])
) as Record<MissionArtifactKey, string>;

export const MISSION_ARTIFACTS: Readonly<Record<MissionArtifactKey, string>> = Object.fromEntries(
    MISSION_ARTIFACT_KEYS.map((key) => [key, WORKFLOW_ARTIFACT_DEFINITIONS[key].fileName])
) as Record<MissionArtifactKey, string>;

export const MISSION_STAGE_FOLDERS: Readonly<Record<MissionStageId, string>> = Object.fromEntries(
    WORKFLOW_STAGE_DEFINITIONS.map((stage) => [stage.id, stage.stageFolder])
) as Record<MissionStageId, string>;

export function getMissionStageDefinition(stageId: MissionStageId): MissionStageDefinition {
    const definition = WORKFLOW_STAGE_DEFINITIONS.find((stage) => stage.id === stageId);
    if (!definition) {
        throw new Error(`Unknown mission stage '${stageId}'.`);
    }
    return definition;
}

export function getMissionArtifactDefinition(artifactKey: MissionArtifactKey): MissionArtifactDefinition {
    return WORKFLOW_ARTIFACT_DEFINITIONS[artifactKey];
}

export function getMissionTaskPairingDefinition(
    stageId: MissionStageId
): MissionTaskPairingDefinition | undefined {
    return getMissionStageDefinition(stageId).taskPairing;
}

export function getInitialMissionStageProgress(stageId: MissionStageId): MissionStageProgress {
    return stageId === MISSION_STAGES[0] ? 'ready' : 'pending';
}

export function isMissionStageId(value: unknown): value is MissionStageId {
    return typeof value === 'string' && (MISSION_STAGES as readonly string[]).includes(value);
}

export function isMissionArtifactKey(value: unknown): value is MissionArtifactKey {
    return typeof value === 'string' && value in WORKFLOW_ARTIFACT_DEFINITIONS;
}

export function isMissionStageProgress(value: unknown): value is MissionStageProgress {
    return typeof value === 'string'
        && (MISSION_STAGE_DERIVED_STATES as readonly string[]).includes(value);
}

type MissionStageRuleContext = {
    currentStatus: MissionStageProgress;
    previousStagesComplete: boolean;
    delivered: boolean;
};

type MissionStageTransitionRule = {
    intent: MissionStageStatusIntent;
    nextStatus: MissionStageProgress;
    allowedFrom: readonly MissionStageProgress[];
    requiresPreviousStagesComplete?: boolean;
};

const WORKFLOW_STAGE_TRANSITION_RULES: readonly MissionStageTransitionRule[] = [
    {
        intent: 'start',
        nextStatus: 'active',
        allowedFrom: ['ready'],
        requiresPreviousStagesComplete: true
    },
    {
        intent: 'restart',
        nextStatus: 'active',
        allowedFrom: ['active', 'completed']
    }
] as const;

type MissionStageRuleEvaluation = {
    enabled: boolean;
    reason?: string;
    nextStatus: MissionStageProgress;
};

export function getPrimaryMissionStageStatusIntent(
    currentStatus: MissionStageProgress
): MissionStageStatusIntent {
    return currentStatus === 'ready' ? 'start' : 'restart';
}

export function evaluateMissionStageStatusIntent(
    intent: MissionStageStatusIntent,
    context: MissionStageRuleContext
): MissionStageRuleEvaluation {
    const rule = WORKFLOW_STAGE_TRANSITION_RULES.find((candidate) => candidate.intent === intent);
    if (!rule) {
        return {
            enabled: false,
            reason: `Stage intent '${intent}' is not defined in the workflow manifest.`,
            nextStatus: context.currentStatus
        };
    }

    if (context.delivered) {
        return {
            enabled: false,
            reason: 'Mission already delivered.',
            nextStatus: rule.nextStatus
        };
    }

    if (!rule.allowedFrom.includes(context.currentStatus)) {
        const allowedStatuses = rule.allowedFrom.join(', ');
        return {
            enabled: false,
            reason: `Stage status ${context.currentStatus} cannot transition via ${intent}. Allowed from: ${allowedStatuses}.`,
            nextStatus: rule.nextStatus
        };
    }

    if (rule.requiresPreviousStagesComplete && !context.previousStagesComplete) {
        return {
            enabled: false,
            reason: 'Previous stages must be complete.',
            nextStatus: rule.nextStatus
        };
    }

    return {
        enabled: true,
        nextStatus: rule.nextStatus
    };
}

type MissionTaskRuleContext = {
    currentStatus: MissionWorkflowTaskStatus;
    waitingOn: readonly string[];
    delivered: boolean;
};

type MissionTaskTransitionRule = {
    intent: MissionTaskStatusIntent;
    nextStatus: MissionWorkflowTaskStatus;
    allowedFrom: readonly MissionWorkflowTaskStatus[];
    requiresDependenciesClear?: boolean;
};

const WORKFLOW_TASK_TRANSITION_RULES: readonly MissionTaskTransitionRule[] = [
    {
        intent: 'start',
        nextStatus: 'queued',
        allowedFrom: ['ready'],
        requiresDependenciesClear: true
    },
    {
        intent: 'done',
        nextStatus: 'completed',
        allowedFrom: ['ready', 'queued', 'running']
    },
    {
        intent: 'reopen',
        nextStatus: 'pending',
        allowedFrom: ['completed', 'failed', 'cancelled']
    }
] as const;

type MissionTaskRuleEvaluation = {
    enabled: boolean;
    reason?: string;
    nextStatus: MissionWorkflowTaskStatus;
};

export function evaluateMissionTaskStatusIntent(
    intent: MissionTaskStatusIntent,
    context: MissionTaskRuleContext
): MissionTaskRuleEvaluation {
    const rule = WORKFLOW_TASK_TRANSITION_RULES.find((candidate) => candidate.intent === intent);
    if (!rule) {
        return {
            enabled: false,
            reason: `Task intent '${intent}' is not defined in the workflow manifest.`,
            nextStatus: context.currentStatus
        };
    }

    if (context.delivered) {
        return {
            enabled: false,
            reason: 'Mission already delivered.',
            nextStatus: rule.nextStatus
        };
    }

    if (context.currentStatus === rule.nextStatus) {
        return {
            enabled: false,
            reason: `Task is already ${rule.nextStatus}.`,
            nextStatus: rule.nextStatus
        };
    }

    if (!rule.allowedFrom.includes(context.currentStatus)) {
        const allowedStatuses = rule.allowedFrom.join(', ');
        return {
            enabled: false,
            reason: `Task status ${context.currentStatus} cannot transition to ${rule.nextStatus}. Allowed from: ${allowedStatuses}.`,
            nextStatus: rule.nextStatus
        };
    }

    if (rule.requiresDependenciesClear && context.waitingOn.length > 0) {
        return {
            enabled: false,
            reason: `Waiting on ${context.waitingOn.join(', ')}.`,
            nextStatus: rule.nextStatus
        };
    }

    return {
        enabled: true,
        nextStatus: rule.nextStatus
    };
}

export function evaluateMissionTaskLaunchEligibility(
    context: MissionTaskRuleContext
): { enabled: boolean; reason?: string } {
    if (context.delivered) {
        return { enabled: false, reason: 'Mission already delivered.' };
    }
    if (context.currentStatus === 'completed') {
        return { enabled: false, reason: 'Task is already complete.' };
    }
    if (context.currentStatus === 'failed' || context.currentStatus === 'cancelled') {
        return { enabled: false, reason: `Task is ${context.currentStatus}.` };
    }
    if (context.currentStatus === 'pending') {
        return { enabled: false, reason: 'Task is not ready.' };
    }
    if (context.waitingOn.length > 0) {
        return { enabled: false, reason: `Waiting on ${context.waitingOn.join(', ')}.` };
    }
    return { enabled: true };
}
