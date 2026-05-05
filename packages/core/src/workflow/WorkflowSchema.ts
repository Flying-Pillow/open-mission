import { z } from 'zod/v4';
import { MissionAgentRunnerSchema, MissionReasoningEffortSchema } from '../entities/Mission/MissionSchema.js';
import { StageIdSchema } from '../entities/Stage/StageSchema.js';
import { TaskIdSchema } from '../entities/Task/TaskSchema.js';

export type WorkflowSettingsValidationError = {
	code: string;
	path: string;
	message: string;
};

export const WorkflowMissionAutostartSettingsSchema = z.object({
	mission: z.boolean()
}).strict();

export const WorkflowHumanInLoopSettingsSchema = z.object({
	enabled: z.boolean(),
	pauseOnMissionStart: z.boolean()
}).strict();

export const WorkflowExecutionSettingsSchema = z.object({
	maxParallelTasks: z.number().int().min(1),
	maxParallelSessions: z.number().int().min(1)
}).strict();

export const WorkflowStageTaskLaunchPolicySchema = z.object({
	defaultAutostart: z.boolean()
}).strict();

export const WorkflowStageDefinitionSchema = z.object({
	stageId: StageIdSchema,
	displayName: z.string().trim().min(1),
	taskLaunchPolicy: WorkflowStageTaskLaunchPolicySchema
}).strict();

export const WorkflowGeneratedTaskDefinitionSchema = z.object({
	taskId: TaskIdSchema,
	title: z.string().trim().min(1),
	instruction: z.string().trim().min(1),
	model: z.string().trim().min(1).optional(),
	reasoningEffort: MissionReasoningEffortSchema.optional(),
	taskKind: z.enum(['implementation', 'verification']).optional(),
	pairedTaskId: TaskIdSchema.optional(),
	dependsOn: z.array(TaskIdSchema),
	agentRunner: MissionAgentRunnerSchema.optional()
}).strict();

export const WorkflowTaskTemplateSourceSchema = z.object({
	templateId: z.string().trim().min(1),
	path: z.string().trim().min(1)
}).strict();

export const WorkflowTaskGenerationRuleSchema = z.object({
	stageId: StageIdSchema,
	artifactTasks: z.boolean(),
	templateSources: z.array(WorkflowTaskTemplateSourceSchema),
	tasks: z.array(WorkflowGeneratedTaskDefinitionSchema)
}).strict();

export const WorkflowGateDefinitionSchema = z.object({
	gateId: z.string().trim().min(1),
	intent: z.enum(['implement', 'verify', 'audit', 'deliver']),
	stageId: StageIdSchema.optional()
}).strict();

export const WorkflowDefinitionSchema = z.object({
	autostart: WorkflowMissionAutostartSettingsSchema,
	humanInLoop: WorkflowHumanInLoopSettingsSchema,
	execution: WorkflowExecutionSettingsSchema,
	stageOrder: z.array(StageIdSchema),
	stages: z.record(StageIdSchema, WorkflowStageDefinitionSchema),
	taskGeneration: z.array(WorkflowTaskGenerationRuleSchema),
	gates: z.array(WorkflowGateDefinitionSchema)
}).strict().superRefine((settings, context) => {
	if (settings.stageOrder.length === 0) {
		context.addIssue({
			code: 'custom',
			path: ['stageOrder'],
			message: 'stageOrder must be a non-empty array.'
		});
	}

	const stageOrderSet = new Set<string>();
	for (const [index, stageId] of settings.stageOrder.entries()) {
		if (stageOrderSet.has(stageId)) {
			context.addIssue({
				code: 'custom',
				path: ['stageOrder', index],
				message: `stageOrder contains duplicate stage '${stageId}'.`
			});
		}
		stageOrderSet.add(stageId);
	}

	for (const stageId of Object.keys(settings.stages).sort()) {
		if (!stageOrderSet.has(stageId)) {
			context.addIssue({
				code: 'custom',
				path: ['stageOrder'],
				message: `stageOrder is missing stage '${stageId}'.`
			});
		}
	}

	for (const [index, stageId] of settings.stageOrder.entries()) {
		if (!Object.prototype.hasOwnProperty.call(settings.stages, stageId)) {
			context.addIssue({
				code: 'custom',
				path: ['stageOrder', index],
				message: `stageOrder references unknown stage '${stageId}'.`
			});
		}
	}

	for (const [stageId, definition] of Object.entries(settings.stages).sort(([left], [right]) => left.localeCompare(right))) {
		if (definition.stageId !== stageId) {
			context.addIssue({
				code: 'custom',
				path: ['stages', stageId, 'stageId'],
				message: `Stage '${stageId}' must declare a matching stageId.`
			});
		}
	}

	for (const [index, gate] of settings.gates.entries()) {
		if (gate.stageId && !Object.prototype.hasOwnProperty.call(settings.stages, gate.stageId)) {
			context.addIssue({
				code: 'custom',
				path: ['gates', index, 'stageId'],
				message: `Gate '${gate.gateId}' references unknown stage '${gate.stageId}'.`
			});
		}
	}

	for (const [index, rule] of settings.taskGeneration.entries()) {
		if (!Object.prototype.hasOwnProperty.call(settings.stages, rule.stageId)) {
			context.addIssue({
				code: 'custom',
				path: ['taskGeneration', index, 'stageId'],
				message: `Task generation rule at index ${String(index)} references unknown stage '${rule.stageId}'.`
			});
		}
	}
});

export const WorkflowRuntimeSettingsSchema = z.object({
	agentRunner: MissionAgentRunnerSchema,
	defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
	defaultModel: z.string().trim().min(1).optional(),
	defaultReasoningEffort: MissionReasoningEffortSchema.optional()
}).strict();

export const WorkflowIntegrationSettingsSchema = z.object({
	trackingProvider: z.literal('github')
}).strict();

export const WorkflowPathSettingsSchema = z.object({
	missionsRoot: z.string().trim().min(1),
	instructionsPath: z.string().trim().min(1),
	skillsPath: z.string().trim().min(1)
}).strict();

export type WorkflowMissionAutostartSettings = z.infer<typeof WorkflowMissionAutostartSettingsSchema>;
export type WorkflowHumanInLoopSettings = z.infer<typeof WorkflowHumanInLoopSettingsSchema>;
export type WorkflowExecutionSettings = z.infer<typeof WorkflowExecutionSettingsSchema>;
export type WorkflowStageTaskLaunchPolicy = z.infer<typeof WorkflowStageTaskLaunchPolicySchema>;
export type WorkflowStageDefinition = z.infer<typeof WorkflowStageDefinitionSchema>;
export type WorkflowGeneratedTaskDefinition = z.infer<typeof WorkflowGeneratedTaskDefinitionSchema>;
export type WorkflowTaskTemplateSource = z.infer<typeof WorkflowTaskTemplateSourceSchema>;
export type WorkflowTaskGenerationRule = z.infer<typeof WorkflowTaskGenerationRuleSchema>;
export type WorkflowGateDefinition = z.infer<typeof WorkflowGateDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowRuntimeSettings = z.infer<typeof WorkflowRuntimeSettingsSchema>;
export type WorkflowIntegrationSettings = z.infer<typeof WorkflowIntegrationSettingsSchema>;
export type WorkflowPathSettings = z.infer<typeof WorkflowPathSettingsSchema>;
