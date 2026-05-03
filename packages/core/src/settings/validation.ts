import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';
import {
	type WorkflowDefinition,
	type WorkflowStageDefinition
} from '../workflow/engine/index.js';
import { WorkflowDefinitionSchema } from '../workflow/WorkflowSchema.js';
import { WorkflowSettingsError, type WorkflowSettingsValidationError } from './types.js';

export function normalizeWorkflowSettings(input: unknown): WorkflowDefinition {
	const defaults = createDefaultWorkflowSettings();
	if (!input || typeof input !== 'object') {
		return defaults;
	}

	const source = input as Partial<WorkflowDefinition>;
	return {
		autostart: {
			mission: asBoolean(source.autostart?.mission, defaults.autostart.mission)
		},
		humanInLoop: {
			enabled: asBoolean(source.humanInLoop?.enabled, defaults.humanInLoop.enabled),
			pauseOnMissionStart: asBoolean(source.humanInLoop?.pauseOnMissionStart, defaults.humanInLoop.pauseOnMissionStart)
		},
		panic: {
			terminateSessions: asBoolean(source.panic?.terminateSessions, defaults.panic.terminateSessions),
			clearLaunchQueue: asBoolean(source.panic?.clearLaunchQueue, defaults.panic.clearLaunchQueue),
			haltMission: asBoolean(source.panic?.haltMission, defaults.panic.haltMission)
		},
		execution: {
			maxParallelTasks: asNumber(source.execution?.maxParallelTasks, defaults.execution.maxParallelTasks),
			maxParallelSessions: asNumber(source.execution?.maxParallelSessions, defaults.execution.maxParallelSessions)
		},
		stageOrder: Array.isArray(source.stageOrder)
			? source.stageOrder.filter((value): value is string => typeof value === 'string')
			: [...defaults.stageOrder],
		stages: normalizeStages(source.stages, defaults.stages),
		taskGeneration: Array.isArray(source.taskGeneration)
			? source.taskGeneration
				.filter((rule): rule is WorkflowDefinition['taskGeneration'][number] => Boolean(rule && typeof rule === 'object'))
				.map((rule) => ({
					stageId: typeof rule.stageId === 'string' ? rule.stageId : '',
					artifactTasks: asBoolean(rule.artifactTasks, defaults.taskGeneration.find((candidate) => candidate.stageId === rule.stageId)?.artifactTasks ?? false),
					templateSources: Array.isArray(rule.templateSources)
						? rule.templateSources
							.filter((sourceRule): sourceRule is WorkflowDefinition['taskGeneration'][number]['templateSources'][number] => Boolean(sourceRule && typeof sourceRule === 'object'))
							.map((sourceRule) => ({
								templateId: typeof sourceRule.templateId === 'string' ? sourceRule.templateId : '',
								path: typeof sourceRule.path === 'string' ? sourceRule.path : ''
							}))
						: [],
					tasks: Array.isArray(rule.tasks)
						? rule.tasks
							.filter((task): task is WorkflowDefinition['taskGeneration'][number]['tasks'][number] => Boolean(task && typeof task === 'object'))
							.map((task) => ({
								taskId: typeof task.taskId === 'string' ? task.taskId : '',
								title: typeof task.title === 'string' ? task.title : '',
								instruction: typeof task.instruction === 'string' ? task.instruction : '',
								...(task.taskKind === 'implementation' || task.taskKind === 'verification'
									? { taskKind: task.taskKind }
									: {}),
								...(typeof task.pairedTaskId === 'string' && task.pairedTaskId.trim().length > 0
									? { pairedTaskId: task.pairedTaskId.trim() }
									: {}),
								dependsOn: Array.isArray(task.dependsOn)
									? task.dependsOn.filter((dependency): dependency is string => typeof dependency === 'string')
									: [],
								...(typeof task.agentRunner === 'string'
									? { agentRunner: task.agentRunner.trim() }
									: {})
							}))
						: []
				}))
			: structuredClone(defaults.taskGeneration),
		gates: Array.isArray(source.gates)
			? source.gates
				.filter((gate): gate is WorkflowDefinition['gates'][number] => Boolean(gate && typeof gate === 'object'))
				.map((gate) => ({
					gateId: typeof gate.gateId === 'string' ? gate.gateId : '',
					intent: isGateIntent(gate.intent) ? gate.intent : 'implement',
					...(typeof gate.stageId === 'string' ? { stageId: gate.stageId } : {})
				}))
			: structuredClone(defaults.gates)
	};
}

export function parsePersistedWorkflowSettings(input: unknown): WorkflowDefinition {
	const parsed = WorkflowDefinitionSchema.safeParse(input);
	if (!parsed.success) {
		throw new WorkflowSettingsError(
			'SETTINGS_VALIDATION_FAILED',
			`Workflow settings validation failed: ${parsed.error.issues.map((issue) => `${toJsonPointer(issue.path)} (${issue.code})`).join(', ')}`,
			{
				validationErrors: toWorkflowSettingsValidationErrors(parsed.error.issues)
			}
		);
	}
	return parsed.data;
}

export function validateWorkflowSettings(settings: WorkflowDefinition): WorkflowSettingsValidationError[] {
	const parsed = WorkflowDefinitionSchema.safeParse(settings);
	return parsed.success ? [] : toWorkflowSettingsValidationErrors(parsed.error.issues);
}

export function assertValidWorkflowSettings(settings: WorkflowDefinition): void {
	const validationErrors = validateWorkflowSettings(settings);
	if (validationErrors.length === 0) {
		return;
	}

	throw new WorkflowSettingsError(
		'SETTINGS_VALIDATION_FAILED',
		`Workflow settings validation failed: ${validationErrors.map((error) => `${error.path} (${error.code})`).join(', ')}`,
		{ validationErrors }
	);
}

function normalizeStages(
	input: WorkflowDefinition['stages'] | undefined,
	defaults: WorkflowDefinition['stages']
): WorkflowDefinition['stages'] {
	if (!input || typeof input !== 'object') {
		return structuredClone(defaults);
	}

	const merged: WorkflowDefinition['stages'] = {};
	for (const [stageId, defaultStage] of Object.entries(defaults)) {
		const candidate = input[stageId] as Partial<WorkflowStageDefinition> | undefined;
		merged[stageId] = {
			stageId: typeof candidate?.stageId === 'string' ? candidate.stageId : defaultStage.stageId,
			displayName: typeof candidate?.displayName === 'string' ? candidate.displayName : defaultStage.displayName,
			taskLaunchPolicy: {
				defaultAutostart: asBoolean(candidate?.taskLaunchPolicy?.defaultAutostart, defaultStage.taskLaunchPolicy.defaultAutostart)
			}
		};
	}

	for (const [stageId, candidate] of Object.entries(input)) {
		if (Object.prototype.hasOwnProperty.call(merged, stageId)) {
			continue;
		}
		if (!candidate || typeof candidate !== 'object') {
			continue;
		}
		const candidateStage = candidate as Partial<WorkflowStageDefinition>;
		merged[stageId] = {
			stageId: typeof candidateStage.stageId === 'string' ? candidateStage.stageId : stageId,
			displayName: typeof candidateStage.displayName === 'string' ? candidateStage.displayName : stageId,
			taskLaunchPolicy: {
				defaultAutostart: asBoolean(candidateStage.taskLaunchPolicy?.defaultAutostart, false)
			}
		};
	}

	return merged;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isGateIntent(value: unknown): value is WorkflowDefinition['gates'][number]['intent'] {
	return value === 'implement' || value === 'verify' || value === 'audit' || value === 'deliver';
}

function escapeJsonPointerToken(value: string): string {
	return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function toWorkflowSettingsValidationErrors(
	issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey>; message: string }>
): WorkflowSettingsValidationError[] {
	return issues.map((issue) => ({
		code: issue.code,
		path: toJsonPointer(issue.path),
		message: issue.message
	}));
}

function toJsonPointer(path: ReadonlyArray<PropertyKey>): string {
	if (path.length === 0) {
		return '/';
	}

	return `/${path.map((segment) => escapeJsonPointerToken(String(segment))).join('/')}`;
}
