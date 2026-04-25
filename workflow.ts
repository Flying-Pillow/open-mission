import type {
    WorkflowGateDefinition,
    WorkflowGlobalSettings
} from '../WorkflowSchema.js';
import { WorkflowGlobalSettingsSchema } from '../WorkflowSchema.js';

export type WorkflowSettingsValidationError = {
    code: string;
    path: string;
    message: string;
};

export const DEFAULT_WORKFLOW_VERSION = 'mission-workflow-v1';

const DEFAULT_WORKFLOW_SETTINGS: WorkflowGlobalSettings = {
    autostart: { mission: true },
    humanInLoop: { enabled: true, pauseOnMissionStart: false },
    panic: { terminateSessions: true, clearLaunchQueue: true, haltMission: true },
    execution: { maxParallelTasks: 1, maxParallelSessions: 1 },
    stageOrder: ['prd', 'spec', 'implementation', 'audit', 'delivery'],
    stages: {
        prd: { stageId: 'prd', displayName: 'PRD', taskLaunchPolicy: { defaultAutostart: true } },
        spec: { stageId: 'spec', displayName: 'Spec', taskLaunchPolicy: { defaultAutostart: true } },
        implementation: { stageId: 'implementation', displayName: 'Implement', taskLaunchPolicy: { defaultAutostart: false } },
        audit: { stageId: 'audit', displayName: 'Audit', taskLaunchPolicy: { defaultAutostart: true } },
        delivery: { stageId: 'delivery', displayName: 'Delivery', taskLaunchPolicy: { defaultAutostart: false } }
    },
    taskGeneration: [
        { stageId: 'prd', artifactTasks: false, templateSources: [{ templateId: 'prd-from-brief', path: 'tasks/PRD/01-prd-from-brief.md' }], tasks: [] },
        { stageId: 'spec', artifactTasks: false, templateSources: [
            { templateId: 'draft-spec', path: 'tasks/SPEC/01-spec-from-prd.md' },
            { templateId: 'plan-implementation', path: 'tasks/SPEC/02-plan.md' }
        ], tasks: [] },
        { stageId: 'implementation', artifactTasks: true, templateSources: [], tasks: [] },
        { stageId: 'audit', artifactTasks: false, templateSources: [
            { templateId: 'debrief', path: 'tasks/AUDIT/01-debrief.md' },
            { templateId: 'touchdown', path: 'tasks/AUDIT/02-touchdown.md' }
        ], tasks: [] },
        { stageId: 'delivery', artifactTasks: false, templateSources: [], tasks: [] }
    ],
    gates: [
        { gateId: 'implement', intent: 'implement', stageId: 'implementation' },
        { gateId: 'verify', intent: 'verify', stageId: 'implementation' },
        { gateId: 'audit', intent: 'audit', stageId: 'audit' },
        { gateId: 'deliver', intent: 'deliver', stageId: 'delivery' }
    ]
};

const MissionWorkflowSettingsSchema = WorkflowGlobalSettingsSchema.superRefine((settings, context) => {
    const stageOrderSet = new Set<string>();
    for (const [index, stageId] of settings.stageOrder.entries()) {
        if (stageOrderSet.has(stageId)) {
            context.addIssue({
                code: 'custom',
                message: `stageOrder contains duplicate stage '${stageId}'.`,
                path: ['stageOrder', index]
            });
        }
        stageOrderSet.add(stageId);
    }
    for (const stageId of Object.keys(settings.stages)) {
        if (!stageOrderSet.has(stageId)) {
            context.addIssue({
                code: 'custom',
                message: `stageOrder is missing stage '${stageId}'.`,
                path: ['stageOrder']
            });
        }
    }
    for (const [index, stageId] of settings.stageOrder.entries()) {
        if (!Object.prototype.hasOwnProperty.call(settings.stages, stageId)) {
            context.addIssue({
                code: 'custom',
                message: `stageOrder references unknown stage '${stageId}'.`,
                path: ['stageOrder', index]
            });
        }
    }
    for (const [stageId, definition] of Object.entries(settings.stages)) {
        if (definition.stageId !== stageId) {
            context.addIssue({
                code: 'custom',
                message: `Stage '${stageId}' must declare a matching stageId.`,
                path: ['stages', stageId, 'stageId']
            });
        }
    }
    for (const [index, gate] of settings.gates.entries()) {
        if (gate.stageId && !Object.prototype.hasOwnProperty.call(settings.stages, gate.stageId)) {
            context.addIssue({
                code: 'custom',
                message: `Gate '${gate.gateId}' references unknown stage '${gate.stageId}'.`,
                path: ['gates', index, 'stageId']
            });
        }
    }
    for (const [index, rule] of settings.taskGeneration.entries()) {
        if (!Object.prototype.hasOwnProperty.call(settings.stages, rule.stageId)) {
            context.addIssue({
                code: 'custom',
                message: `Task generation rule at index ${String(index)} references unknown stage '${rule.stageId}'.`,
                path: ['taskGeneration', index, 'stageId']
            });
        }
    }
});

export function createDefaultWorkflowSettings(): WorkflowGlobalSettings {
    return structuredClone(DEFAULT_WORKFLOW_SETTINGS);
}

export function normalizeWorkflowSettings(input: unknown): WorkflowGlobalSettings {
    const defaults = createDefaultWorkflowSettings();
    const source = isRecord(input) ? input : {};
    return MissionWorkflowSettingsSchema.parse({
        autostart: {
            mission: readBoolean(source['autostart'], 'mission', defaults.autostart.mission)
        },
        humanInLoop: {
            enabled: readBoolean(source['humanInLoop'], 'enabled', defaults.humanInLoop.enabled),
            pauseOnMissionStart: readBoolean(source['humanInLoop'], 'pauseOnMissionStart', defaults.humanInLoop.pauseOnMissionStart)
        },
        panic: {
            terminateSessions: readBoolean(source['panic'], 'terminateSessions', defaults.panic.terminateSessions),
            clearLaunchQueue: readBoolean(source['panic'], 'clearLaunchQueue', defaults.panic.clearLaunchQueue),
            haltMission: readBoolean(source['panic'], 'haltMission', defaults.panic.haltMission)
        },
        execution: {
            maxParallelTasks: readNumber(source['execution'], 'maxParallelTasks', defaults.execution.maxParallelTasks),
            maxParallelSessions: readNumber(source['execution'], 'maxParallelSessions', defaults.execution.maxParallelSessions)
        },
        stageOrder: Array.isArray(source['stageOrder'])
            ? source['stageOrder'].filter((value): value is string => typeof value === 'string')
            : [...defaults.stageOrder],
        stages: normalizeStages(source['stages'], defaults.stages),
        taskGeneration: normalizeTaskGeneration(source['taskGeneration'], defaults.taskGeneration),
        gates: normalizeGates(source['gates'], defaults.gates)
    });
}

export function validateWorkflowSettings(input: unknown): WorkflowSettingsValidationError[] {
    const result = MissionWorkflowSettingsSchema.safeParse(input);
    return result.success
        ? []
        : result.error.issues.map((issue) => ({
            code: issue.code,
            path: `/${issue.path.map((segment) => String(segment).replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/')}`,
            message: issue.message
        }));
}

export function listWorkflowSettingsValidationErrors(input: unknown): WorkflowSettingsValidationError[] {
    return validateWorkflowSettings(input);
}

export function assertValidWorkflowSettings(input: unknown): WorkflowGlobalSettings {
    return MissionWorkflowSettingsSchema.parse(input);
}

function normalizeStages(input: unknown, defaults: WorkflowGlobalSettings['stages']): WorkflowGlobalSettings['stages'] {
    if (!isRecord(input)) {
        return structuredClone(defaults);
    }
    const merged: WorkflowGlobalSettings['stages'] = {};
    for (const [stageId, defaultStage] of Object.entries(defaults)) {
        const candidate = isRecord(input[stageId]) ? input[stageId] : {};
        merged[stageId] = {
            stageId: typeof candidate['stageId'] === 'string' ? candidate['stageId'] : defaultStage.stageId,
            displayName: typeof candidate['displayName'] === 'string' ? candidate['displayName'] : defaultStage.displayName,
            taskLaunchPolicy: {
                defaultAutostart: readBoolean(candidate['taskLaunchPolicy'], 'defaultAutostart', defaultStage.taskLaunchPolicy.defaultAutostart)
            }
        };
    }
    for (const [stageId, rawCandidate] of Object.entries(input)) {
        if (stageId in merged || !isRecord(rawCandidate)) {
            continue;
        }
        merged[stageId] = {
            stageId: typeof rawCandidate['stageId'] === 'string' ? rawCandidate['stageId'] : stageId,
            displayName: typeof rawCandidate['displayName'] === 'string' ? rawCandidate['displayName'] : stageId,
            taskLaunchPolicy: {
                defaultAutostart: readBoolean(rawCandidate['taskLaunchPolicy'], 'defaultAutostart', false)
            }
        };
    }
    return merged;
}

function normalizeTaskGeneration(input: unknown, defaults: WorkflowGlobalSettings['taskGeneration']): WorkflowGlobalSettings['taskGeneration'] {
    if (!Array.isArray(input)) {
        return structuredClone(defaults);
    }
    return input
        .filter((rule): rule is Record<string, unknown> => isRecord(rule))
        .map((rule) => ({
            stageId: typeof rule['stageId'] === 'string' ? rule['stageId'] : '',
            artifactTasks: typeof rule['artifactTasks'] === 'boolean' ? rule['artifactTasks'] : false,
            templateSources: Array.isArray(rule['templateSources'])
                ? rule['templateSources']
                    .filter((source): source is Record<string, unknown> => isRecord(source))
                    .map((source) => ({
                        templateId: typeof source['templateId'] === 'string' ? source['templateId'] : '',
                        path: typeof source['path'] === 'string' ? source['path'] : ''
                    }))
                : [],
            tasks: Array.isArray(rule['tasks'])
                ? rule['tasks']
                    .filter((task): task is Record<string, unknown> => isRecord(task))
                    .map((task) => ({
                        taskId: typeof task['taskId'] === 'string' ? task['taskId'] : '',
                        title: typeof task['title'] === 'string' ? task['title'] : '',
                        instruction: typeof task['instruction'] === 'string' ? task['instruction'] : '',
                        ...(task['taskKind'] === 'implementation' || task['taskKind'] === 'verification' ? { taskKind: task['taskKind'] } : {}),
                        ...(typeof task['pairedTaskId'] === 'string' && task['pairedTaskId'].trim().length > 0 ? { pairedTaskId: task['pairedTaskId'].trim() } : {}),
                        dependsOn: Array.isArray(task['dependsOn']) ? task['dependsOn'].filter((dependency): dependency is string => typeof dependency === 'string') : [],
                        ...(typeof task['agentRunner'] === 'string' && task['agentRunner'].trim().length > 0 ? { agentRunner: task['agentRunner'].trim() } : {})
                    }))
                : []
        }));
}

function normalizeGates(input: unknown, defaults: WorkflowGlobalSettings['gates']): WorkflowGlobalSettings['gates'] {
    if (!Array.isArray(input)) {
        return structuredClone(defaults);
    }
    return input
        .filter((gate): gate is Record<string, unknown> => isRecord(gate))
        .map((gate) => ({
            gateId: typeof gate['gateId'] === 'string' ? gate['gateId'] : '',
            intent: isGateIntent(gate['intent']) ? gate['intent'] : 'implement',
            ...(typeof gate['stageId'] === 'string' ? { stageId: gate['stageId'] } : {})
        }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoolean(container: unknown, key: string, fallback: boolean): boolean {
    return isRecord(container) && typeof container[key] === 'boolean' ? container[key] : fallback;
}

function readNumber(container: unknown, key: string, fallback: number): number {
    return isRecord(container) && typeof container[key] === 'number' && Number.isFinite(container[key])
        ? container[key]
        : fallback;
}

function isGateIntent(value: unknown): value is WorkflowGateDefinition['intent'] {
    return value === 'implement' || value === 'verify' || value === 'audit' || value === 'deliver';
}
