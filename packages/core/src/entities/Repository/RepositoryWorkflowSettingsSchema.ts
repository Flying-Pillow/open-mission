import * as path from 'node:path';
import { z } from 'zod/v4';
import {
	DEFAULT_MISSION_WORKSPACE_ROOT,
	MISSION_DIRECTORY,
	MISSION_WORKFLOW_DEFINITION_FILE,
	MISSION_WORKFLOW_DIRECTORY
} from '../../lib/repoConfig.js';
import {
	assertValidWorkflowSettings,
	normalizeWorkflowSettings
} from '../../settings/validation.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';

const DEFAULT_RUNTIME_SETTINGS = {
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

export const RepositoryWorkflowRuntimeSchema = z.object({
	agentRunner: z.enum(['copilot-cli', 'pi']).default(DEFAULT_RUNTIME_SETTINGS.agentRunner),
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
	const normalized = normalizeWorkflowSettings(input ?? workflowSchemaDefaults);
	try {
		assertValidWorkflowSettings(normalized);
	} catch (error) {
		ctx.addIssue({
			code: 'custom',
			message: error instanceof Error ? error.message : 'Invalid workflow configuration.'
		});
		return z.NEVER;
	}
	return normalized;
});

export const RepositoryWorkflowSettingsSchema = z.object({
	workflow: RepositoryWorkflowDefinitionSchema.default(workflowSchemaDefaults),
	runtime: RepositoryWorkflowRuntimeSchema.default(DEFAULT_RUNTIME_SETTINGS),
	integration: RepositoryWorkflowIntegrationSchema.default(DEFAULT_INTEGRATION_SETTINGS),
	paths: RepositoryWorkflowPathsSchema.default(DEFAULT_PATH_SETTINGS)
}).strict();

export type RepositoryWorkflowRuntimeSettings = z.infer<typeof RepositoryWorkflowRuntimeSchema>;
export type RepositoryWorkflowIntegrationSettings = z.infer<typeof RepositoryWorkflowIntegrationSchema>;
export type RepositoryWorkflowPathSettings = z.infer<typeof RepositoryWorkflowPathsSchema>;
export type RepositoryWorkflowSettings = z.infer<typeof RepositoryWorkflowSettingsSchema>;

export type LegacyMissionDaemonSettings = {
	agentRunner?: RepositoryWorkflowRuntimeSettings['agentRunner'];
	defaultAgentMode?: RepositoryWorkflowRuntimeSettings['defaultAgentMode'];
	defaultModel?: RepositoryWorkflowRuntimeSettings['defaultModel'];
	towerTheme?: RepositoryWorkflowRuntimeSettings['towerTheme'];
	missionWorkspaceRoot?: RepositoryWorkflowPathSettings['missionWorkspaceRoot'];
	trackingProvider?: RepositoryWorkflowIntegrationSettings['trackingProvider'];
	instructionsPath?: RepositoryWorkflowPathSettings['instructionsPath'];
	skillsPath?: RepositoryWorkflowPathSettings['skillsPath'];
	workflow?: RepositoryWorkflowSettings['workflow'];
};

export function createDefaultRepositoryWorkflowSettings(): RepositoryWorkflowSettings {
	return RepositoryWorkflowSettingsSchema.parse({});
}

export function toLegacyMissionDaemonSettings(
	settings: RepositoryWorkflowSettings
): LegacyMissionDaemonSettings {
	return {
		agentRunner: settings.runtime.agentRunner,
		...(settings.runtime.defaultAgentMode ? { defaultAgentMode: settings.runtime.defaultAgentMode } : {}),
		...(settings.runtime.defaultModel ? { defaultModel: settings.runtime.defaultModel } : {}),
		...(settings.runtime.towerTheme ? { towerTheme: settings.runtime.towerTheme } : {}),
		missionWorkspaceRoot: settings.paths.missionWorkspaceRoot,
		trackingProvider: settings.integration.trackingProvider,
		instructionsPath: settings.paths.instructionsPath,
		skillsPath: settings.paths.skillsPath,
		workflow: settings.workflow
	};
}

export function mergeLegacyMissionDaemonSettings(
	overrides: LegacyMissionDaemonSettings = {},
	current: RepositoryWorkflowSettings = createDefaultRepositoryWorkflowSettings()
): RepositoryWorkflowSettings {
	return RepositoryWorkflowSettingsSchema.parse({
		workflow: overrides.workflow ?? current.workflow,
		runtime: {
			agentRunner: overrides.agentRunner ?? current.runtime.agentRunner,
			...(overrides.defaultAgentMode
				? { defaultAgentMode: overrides.defaultAgentMode }
				: current.runtime.defaultAgentMode
					? { defaultAgentMode: current.runtime.defaultAgentMode }
					: {}),
			...(overrides.defaultModel
				? { defaultModel: overrides.defaultModel }
				: current.runtime.defaultModel
					? { defaultModel: current.runtime.defaultModel }
					: {}),
			...(overrides.towerTheme
				? { towerTheme: overrides.towerTheme }
				: current.runtime.towerTheme
					? { towerTheme: current.runtime.towerTheme }
					: {})
		},
		integration: {
			trackingProvider: overrides.trackingProvider ?? current.integration.trackingProvider
		},
		paths: {
			missionWorkspaceRoot: overrides.missionWorkspaceRoot ?? current.paths.missionWorkspaceRoot,
			instructionsPath: overrides.instructionsPath ?? current.paths.instructionsPath,
			skillsPath: overrides.skillsPath ?? current.paths.skillsPath
		}
	});
}

export function getRepositoryWorkflowSettingsDocumentPath(controlRoot: string): string {
	return path.join(
		controlRoot,
		MISSION_DIRECTORY,
		MISSION_WORKFLOW_DIRECTORY,
		MISSION_WORKFLOW_DEFINITION_FILE
	);
}