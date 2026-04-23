import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';
import {
	type WorkflowGlobalSettings,
	type WorkflowStageDefinition
} from '../workflow/engine/index.js';
import { WorkflowSettingsError, type WorkflowSettingsValidationError } from './types.js';

export function normalizeWorkflowSettings(input: unknown): WorkflowGlobalSettings {
	const defaults = createDefaultWorkflowSettings();
	if (!input || typeof input !== 'object') {
		return defaults;
	}

	const source = input as Partial<WorkflowGlobalSettings>;
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
				.filter((rule): rule is WorkflowGlobalSettings['taskGeneration'][number] => Boolean(rule && typeof rule === 'object'))
				.map((rule) => ({
					stageId: typeof rule.stageId === 'string' ? rule.stageId : '',
					artifactTasks: asBoolean(rule.artifactTasks, defaults.taskGeneration.find((candidate) => candidate.stageId === rule.stageId)?.artifactTasks ?? false),
					templateSources: Array.isArray(rule.templateSources)
						? rule.templateSources
							.filter((sourceRule): sourceRule is WorkflowGlobalSettings['taskGeneration'][number]['templateSources'][number] => Boolean(sourceRule && typeof sourceRule === 'object'))
							.map((sourceRule) => ({
								templateId: typeof sourceRule.templateId === 'string' ? sourceRule.templateId : '',
								path: typeof sourceRule.path === 'string' ? sourceRule.path : ''
							}))
						: [],
					tasks: Array.isArray(rule.tasks)
						? rule.tasks
							.filter((task): task is WorkflowGlobalSettings['taskGeneration'][number]['tasks'][number] => Boolean(task && typeof task === 'object'))
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
				.filter((gate): gate is WorkflowGlobalSettings['gates'][number] => Boolean(gate && typeof gate === 'object'))
				.map((gate) => ({
					gateId: typeof gate.gateId === 'string' ? gate.gateId : '',
					intent: isGateIntent(gate.intent) ? gate.intent : 'implement',
					...(typeof gate.stageId === 'string' ? { stageId: gate.stageId } : {})
				}))
			: structuredClone(defaults.gates)
	};
}

export function validateWorkflowSettings(settings: WorkflowGlobalSettings): WorkflowSettingsValidationError[] {
	const errors: WorkflowSettingsValidationError[] = [];
	if (!Number.isInteger(settings.execution.maxParallelTasks) || settings.execution.maxParallelTasks < 1) {
		errors.push({
			code: 'INVALID_EXECUTION_LIMIT',
			path: '/execution/maxParallelTasks',
			message: 'execution.maxParallelTasks must be an integer greater than or equal to 1.'
		});
	}
	if (!Number.isInteger(settings.execution.maxParallelSessions) || settings.execution.maxParallelSessions < 1) {
		errors.push({
			code: 'INVALID_EXECUTION_LIMIT',
			path: '/execution/maxParallelSessions',
			message: 'execution.maxParallelSessions must be an integer greater than or equal to 1.'
		});
	}

	if (!Array.isArray(settings.stageOrder) || settings.stageOrder.length === 0) {
		errors.push({
			code: 'INVALID_STAGE_ORDER',
			path: '/stageOrder',
			message: 'stageOrder must be a non-empty array.'
		});
	}

	const stageOrderSet = new Set<string>();
	for (const [index, stageId] of settings.stageOrder.entries()) {
		if (stageOrderSet.has(stageId)) {
			errors.push({
				code: 'INVALID_STAGE_ORDER',
				path: `/stageOrder/${String(index)}`,
				message: `stageOrder contains duplicate stage '${stageId}'.`
			});
		}
		stageOrderSet.add(stageId);
	}

	const stageKeys = Object.keys(settings.stages).sort();
	for (const stageId of stageKeys) {
		if (!stageOrderSet.has(stageId)) {
			errors.push({
				code: 'INVALID_STAGE_ORDER',
				path: '/stageOrder',
				message: `stageOrder is missing stage '${stageId}'.`
			});
		}
	}

	for (const [index, stageId] of settings.stageOrder.entries()) {
		if (!Object.prototype.hasOwnProperty.call(settings.stages, stageId)) {
			errors.push({
				code: 'UNKNOWN_STAGE',
				path: `/stageOrder/${String(index)}`,
				message: `stageOrder references unknown stage '${stageId}'.`
			});
		}
	}

	for (const [stageId, definition] of Object.entries(settings.stages).sort(([left], [right]) => left.localeCompare(right))) {
		if (definition.stageId !== stageId) {
			errors.push({
				code: 'STAGE_ID_MISMATCH',
				path: `/stages/${escapeJsonPointerToken(stageId)}/stageId`,
				message: `Stage '${stageId}' must declare a matching stageId.`
			});
		}
	}

	for (const [index, gate] of settings.gates.entries()) {
		if (gate.stageId && !Object.prototype.hasOwnProperty.call(settings.stages, gate.stageId)) {
			errors.push({
				code: 'UNKNOWN_STAGE',
				path: `/gates/${String(index)}/stageId`,
				message: `Gate '${gate.gateId}' references unknown stage '${gate.stageId}'.`
			});
		}
	}

	for (const [index, rule] of settings.taskGeneration.entries()) {
		if (!Object.prototype.hasOwnProperty.call(settings.stages, rule.stageId)) {
			errors.push({
				code: 'UNKNOWN_STAGE',
				path: `/taskGeneration/${String(index)}/stageId`,
				message: `Task generation rule at index ${String(index)} references unknown stage '${rule.stageId}'.`
			});
		}

		for (const [sourceIndex, source] of rule.templateSources.entries()) {
			if (source.templateId.trim().length === 0) {
				errors.push({
					code: 'INVALID_TASK_TEMPLATE_SOURCE',
					path: `/taskGeneration/${String(index)}/templateSources/${String(sourceIndex)}/templateId`,
					message: 'Task template sources must declare a non-empty templateId.'
				});
			}
			if (source.path.trim().length === 0) {
				errors.push({
					code: 'INVALID_TASK_TEMPLATE_SOURCE',
					path: `/taskGeneration/${String(index)}/templateSources/${String(sourceIndex)}/path`,
					message: 'Task template sources must declare a non-empty path.'
				});
			}
		}

		for (const [taskIndex, task] of rule.tasks.entries()) {
			if (task.taskId.trim().length === 0) {
				errors.push({
					code: 'INVALID_GENERATED_TASK',
					path: `/taskGeneration/${String(index)}/tasks/${String(taskIndex)}/taskId`,
					message: 'Generated workflow tasks must declare a non-empty taskId.'
				});
			}
			if (task.title.trim().length === 0) {
				errors.push({
					code: 'INVALID_GENERATED_TASK',
					path: `/taskGeneration/${String(index)}/tasks/${String(taskIndex)}/title`,
					message: 'Generated workflow tasks must declare a non-empty title.'
				});
			}
			if (task.instruction.trim().length === 0) {
				errors.push({
					code: 'INVALID_GENERATED_TASK',
					path: `/taskGeneration/${String(index)}/tasks/${String(taskIndex)}/instruction`,
					message: 'Generated workflow tasks must declare a non-empty instruction.'
				});
			}

			for (const [dependencyIndex, dependency] of task.dependsOn.entries()) {
				if (dependency.trim().length === 0) {
					errors.push({
						code: 'INVALID_GENERATED_TASK',
						path: `/taskGeneration/${String(index)}/tasks/${String(taskIndex)}/dependsOn/${String(dependencyIndex)}`,
						message: 'Generated workflow task dependencies must be non-empty strings.'
					});
				}
			}
		}
	}

	return errors;
}

export function assertValidWorkflowSettings(settings: WorkflowGlobalSettings): void {
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
	input: WorkflowGlobalSettings['stages'] | undefined,
	defaults: WorkflowGlobalSettings['stages']
): WorkflowGlobalSettings['stages'] {
	if (!input || typeof input !== 'object') {
		return structuredClone(defaults);
	}

	const merged: WorkflowGlobalSettings['stages'] = {};
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

function isGateIntent(value: unknown): value is WorkflowGlobalSettings['gates'][number]['intent'] {
	return value === 'implement' || value === 'verify' || value === 'audit' || value === 'deliver';
}

function escapeJsonPointerToken(value: string): string {
	return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}
