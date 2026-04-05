export type MissionStageId = 'prd' | 'spec' | 'implementation' | 'audit' | 'delivery';

export type MissionWorkflowTaskStatus = 'todo' | 'active' | 'blocked' | 'done';
export type MissionTaskStatusIntent = 'active' | 'done' | 'blocked';
export type MissionStageStatusIntent = 'start' | 'restart';

export type MissionArtifactKey = 'brief' | 'prd' | 'spec' | 'verify' | 'audit' | 'delivery';

export type MissionStageProgress = 'pending' | 'active' | 'blocked' | 'done';

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
    folder: string;
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
        folder: '01-PRD',
        artifacts: ['prd']
    },
    {
        id: 'spec',
        folder: '02-SPEC',
        artifacts: ['spec']
    },
    {
        id: 'implementation',
        folder: '03-IMPLEMENTATION',
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
        folder: '04-AUDIT',
        artifacts: ['audit']
    },
    {
        id: 'delivery',
        folder: '05-DELIVERY',
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

export const MISSION_STAGES: readonly MissionStageId[] = WORKFLOW_STAGE_DEFINITIONS.map((stage) => stage.id);

export const MISSION_ARTIFACT_KEYS: readonly MissionArtifactKey[] = Object.keys(
    WORKFLOW_ARTIFACT_DEFINITIONS
) as MissionArtifactKey[];

export const MISSION_ARTIFACT_LABELS: Readonly<Record<MissionArtifactKey, string>> = Object.fromEntries(
    MISSION_ARTIFACT_KEYS.map((key) => [key, WORKFLOW_ARTIFACT_DEFINITIONS[key].label])
) as Record<MissionArtifactKey, string>;

export const MISSION_ARTIFACTS: Readonly<Record<MissionArtifactKey, string>> = Object.fromEntries(
    MISSION_ARTIFACT_KEYS.map((key) => [key, WORKFLOW_ARTIFACT_DEFINITIONS[key].fileName])
) as Record<MissionArtifactKey, string>;

export const MISSION_TASK_STAGE_DIRECTORIES: Readonly<Record<MissionStageId, string>> = Object.fromEntries(
    WORKFLOW_STAGE_DEFINITIONS.map((stage) => [stage.id, stage.folder])
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
    return stageId === MISSION_STAGES[0] ? 'active' : 'pending';
}

export function isMissionStageId(value: unknown): value is MissionStageId {
    return typeof value === 'string' && (MISSION_STAGES as readonly string[]).includes(value);
}

export function isMissionArtifactKey(value: unknown): value is MissionArtifactKey {
    return typeof value === 'string' && value in WORKFLOW_ARTIFACT_DEFINITIONS;
}

export function isMissionStageProgress(value: unknown): value is MissionStageProgress {
    return value === 'pending' || value === 'active' || value === 'blocked' || value === 'done';
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
        allowedFrom: ['pending'],
        requiresPreviousStagesComplete: true
    },
    {
        intent: 'restart',
        nextStatus: 'active',
        allowedFrom: ['active', 'blocked', 'done']
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
    return currentStatus === 'pending' ? 'start' : 'restart';
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
    blockedBy: readonly string[];
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
        intent: 'active',
        nextStatus: 'active',
        allowedFrom: ['todo', 'blocked'],
        requiresDependenciesClear: true
    },
    {
        intent: 'done',
        nextStatus: 'done',
        allowedFrom: ['todo', 'active', 'blocked']
    },
    {
        intent: 'blocked',
        nextStatus: 'blocked',
        allowedFrom: ['todo', 'active']
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

    if (rule.requiresDependenciesClear && context.blockedBy.length > 0) {
        return {
            enabled: false,
            reason: `Waiting on ${context.blockedBy.join(', ')}.`,
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
    if (context.currentStatus === 'done') {
        return { enabled: false, reason: 'Task is already complete.' };
    }
    if (context.currentStatus === 'blocked') {
        return { enabled: false, reason: 'Task is blocked.' };
    }
    if (context.blockedBy.length > 0) {
        return { enabled: false, reason: `Waiting on ${context.blockedBy.join(', ')}.` };
    }
    return { enabled: true };
}
