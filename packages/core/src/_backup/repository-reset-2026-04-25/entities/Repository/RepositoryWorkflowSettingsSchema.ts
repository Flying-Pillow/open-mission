import * as path from 'node:path';
import { z } from 'zod/v4';
import {
	DEFAULT_MISSION_WORKSPACE_ROOT,
	MISSION_DIRECTORY,
	MISSION_WORKFLOW_DEFINITION_FILE,
	MISSION_WORKFLOW_DIRECTORY
} from './RepositoryPaths.js';
import { WorkflowGlobalSettingsSchema } from '../../workflow/WorkflowSchema.js';
import {
	assertValidWorkflowSettings
} from '../../settings/validation.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';

const DEFAULT_AGENT_SETTINGS = {
	agentRunner: 'copilot-cli' as const
};

const DEFAULT_INTEGRATION_SETTINGS = {
	trackingProvider: 'github' as const
};

const DEFAULT_PATH_SETTINGS = {
	missionWorkspaceRoot: DEFAULT_MISSION_WORKSPACE_ROOT,
	instructionsPath: '.agents',
	skillsPath: '.agents/skills'
};

const workflowSchemaDefaults = createDefaultWorkflowSettings();

export const RepositoryWorkflowAgentSchema = z.object({
	agentRunner: z.enum(['copilot-cli', 'pi']).default(DEFAULT_AGENT_SETTINGS.agentRunner),
	defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
	defaultModel: z.string().trim().min(1).optional(),
	towerTheme: z.string().trim().min(1).optional()
}).strict();

export const RepositoryWorkflowIntegrationSchema = z.object({
	trackingProvider: z.literal('github').default(DEFAULT_INTEGRATION_SETTINGS.trackingProvider)
}).strict();

export const RepositoryWorkflowPathsSchema = z.object({
	missionWorkspaceRoot: z.string().trim().min(1).default(DEFAULT_PATH_SETTINGS.missionWorkspaceRoot),
	instructionsPath: z.string().trim().min(1).default(DEFAULT_PATH_SETTINGS.instructionsPath),
	skillsPath: z.string().trim().min(1).default(DEFAULT_PATH_SETTINGS.skillsPath)
}).strict();

export const RepositoryWorkflowDefinitionSchema = z.unknown().optional().transform((input, ctx) => {
	const parsed = WorkflowGlobalSettingsSchema.safeParse(input ?? workflowSchemaDefaults);
	if (!parsed.success) {
		ctx.addIssue({
			code: 'custom',
			message: parsed.error.issues.map((issue) => issue.message).join('; ') || 'Invalid workflow configuration.'
		});
		return z.NEVER;
	}
	try {
		assertValidWorkflowSettings(parsed.data);
	} catch (error) {
		ctx.addIssue({
			code: 'custom',
			message: error instanceof Error ? error.message : 'Invalid workflow configuration.'
		});
		return z.NEVER;
	}
	return parsed.data;
});

export const RepositoryWorkflowSettingsSchema = z.object({
	workflow: RepositoryWorkflowDefinitionSchema.default(workflowSchemaDefaults),
	agent: RepositoryWorkflowAgentSchema.default(DEFAULT_AGENT_SETTINGS),
	integration: RepositoryWorkflowIntegrationSchema.default(DEFAULT_INTEGRATION_SETTINGS),
	paths: RepositoryWorkflowPathsSchema.default(DEFAULT_PATH_SETTINGS)
}).strict();

export type RepositoryWorkflowAgentSettings = z.infer<typeof RepositoryWorkflowAgentSchema>;
export type RepositoryWorkflowIntegrationSettings = z.infer<typeof RepositoryWorkflowIntegrationSchema>;
export type RepositoryWorkflowPathSettings = z.infer<typeof RepositoryWorkflowPathsSchema>;
export type RepositoryWorkflowSettings = z.infer<typeof RepositoryWorkflowSettingsSchema>;

export function createDefaultRepositoryWorkflowSettings(): RepositoryWorkflowSettings {
	return RepositoryWorkflowSettingsSchema.parse({});
}

export function getRepositoryWorkflowSettingsPath(controlRoot: string): string {
	return path.join(
		controlRoot,
		MISSION_DIRECTORY,
		MISSION_WORKFLOW_DIRECTORY,
		MISSION_WORKFLOW_DEFINITION_FILE
	);
}