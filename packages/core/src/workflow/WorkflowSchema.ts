import { z } from 'zod/v4';

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

export const WorkflowPanicSettingsSchema = z.object({
	terminateSessions: z.boolean(),
	clearLaunchQueue: z.boolean(),
	haltMission: z.boolean()
}).strict();

export const WorkflowExecutionSettingsSchema = z.object({
	maxParallelTasks: z.number().int().min(1),
	maxParallelSessions: z.number().int().min(1)
}).strict();

export const WorkflowStageTaskLaunchPolicySchema = z.object({
	defaultAutostart: z.boolean()
}).strict();

export const WorkflowStageDefinitionSchema = z.object({
	stageId: z.string().trim().min(1),
	displayName: z.string().trim().min(1),
	taskLaunchPolicy: WorkflowStageTaskLaunchPolicySchema
}).strict();

export const WorkflowGeneratedTaskDefinitionSchema = z.object({
	taskId: z.string().trim().min(1),
	title: z.string().trim().min(1),
	instruction: z.string().trim().min(1),
	taskKind: z.enum(['implementation', 'verification']).optional(),
	pairedTaskId: z.string().trim().min(1).optional(),
	dependsOn: z.array(z.string().trim().min(1)),
	agentRunner: z.string().trim().min(1).optional()
}).strict();

export const WorkflowTaskTemplateSourceSchema = z.object({
	templateId: z.string().trim().min(1),
	path: z.string().trim().min(1)
}).strict();

export const WorkflowTaskGenerationRuleSchema = z.object({
	stageId: z.string().trim().min(1),
	artifactTasks: z.boolean(),
	templateSources: z.array(WorkflowTaskTemplateSourceSchema),
	tasks: z.array(WorkflowGeneratedTaskDefinitionSchema)
}).strict();

export const WorkflowGateDefinitionSchema = z.object({
	gateId: z.string().trim().min(1),
	intent: z.enum(['implement', 'verify', 'audit', 'deliver']),
	stageId: z.string().trim().min(1).optional()
}).strict();

export const WorkflowGlobalSettingsSchema = z.object({
	autostart: WorkflowMissionAutostartSettingsSchema,
	humanInLoop: WorkflowHumanInLoopSettingsSchema,
	panic: WorkflowPanicSettingsSchema,
	execution: WorkflowExecutionSettingsSchema,
	stageOrder: z.array(z.string().trim().min(1)),
	stages: z.record(z.string().trim().min(1), WorkflowStageDefinitionSchema),
	taskGeneration: z.array(WorkflowTaskGenerationRuleSchema),
	gates: z.array(WorkflowGateDefinitionSchema)
}).strict();

export const WorkflowRuntimeSettingsSchema = z.object({
	agentRunner: z.enum(['copilot-cli', 'pi']),
	defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
	defaultModel: z.string().trim().min(1).optional(),
	towerTheme: z.string().trim().min(1).optional()
}).strict();

export const WorkflowIntegrationSettingsSchema = z.object({
	trackingProvider: z.literal('github')
}).strict();

export const WorkflowPathSettingsSchema = z.object({
	missionWorkspaceRoot: z.string().trim().min(1),
	instructionsPath: z.string().trim().min(1),
	skillsPath: z.string().trim().min(1)
}).strict();

export const WorkflowSettingsDocumentSchema = z.object({
	workflow: WorkflowGlobalSettingsSchema,
	runtime: WorkflowRuntimeSettingsSchema,
	integration: WorkflowIntegrationSettingsSchema,
	paths: WorkflowPathSettingsSchema
}).strict();

export type WorkflowMissionAutostartSettings = z.infer<typeof WorkflowMissionAutostartSettingsSchema>;
export type WorkflowHumanInLoopSettings = z.infer<typeof WorkflowHumanInLoopSettingsSchema>;
export type WorkflowPanicSettings = z.infer<typeof WorkflowPanicSettingsSchema>;
export type WorkflowExecutionSettings = z.infer<typeof WorkflowExecutionSettingsSchema>;
export type WorkflowStageTaskLaunchPolicy = z.infer<typeof WorkflowStageTaskLaunchPolicySchema>;
export type WorkflowStageDefinition = z.infer<typeof WorkflowStageDefinitionSchema>;
export type WorkflowGeneratedTaskDefinition = z.infer<typeof WorkflowGeneratedTaskDefinitionSchema>;
export type WorkflowTaskTemplateSource = z.infer<typeof WorkflowTaskTemplateSourceSchema>;
export type WorkflowTaskGenerationRule = z.infer<typeof WorkflowTaskGenerationRuleSchema>;
export type WorkflowGateDefinition = z.infer<typeof WorkflowGateDefinitionSchema>;
export type WorkflowGlobalSettings = z.infer<typeof WorkflowGlobalSettingsSchema>;
export type WorkflowRuntimeSettings = z.infer<typeof WorkflowRuntimeSettingsSchema>;
export type WorkflowIntegrationSettings = z.infer<typeof WorkflowIntegrationSettingsSchema>;
export type WorkflowPathSettings = z.infer<typeof WorkflowPathSettingsSchema>;
export type WorkflowSettingsDocument = z.infer<typeof WorkflowSettingsDocumentSchema>;