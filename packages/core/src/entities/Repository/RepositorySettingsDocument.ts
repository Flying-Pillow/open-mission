import { z } from 'zod/v4';
import { DEFAULT_MISSION_WORKSPACE_ROOT } from '../../lib/repoConfig.js';
import {
	WorkflowGlobalSettingsSchema,
	type WorkflowGlobalSettings
} from '../../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';

export const RepositoryWorkflowRuntimeSettingsSchema = z.object({
	agentRunner: z.enum(['copilot-cli', 'pi']),
	defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
	defaultModel: z.string().trim().min(1).optional(),
	towerTheme: z.string().trim().min(1).optional()
}).strict();

export const RepositoryWorkflowIntegrationSettingsSchema = z.object({
	trackingProvider: z.literal('github')
}).strict();

export const RepositoryWorkflowPathSettingsSchema = z.object({
	missionWorkspaceRoot: z.string().trim().min(1),
	instructionsPath: z.string().trim().min(1),
	skillsPath: z.string().trim().min(1)
}).strict();

export const RepositoryWorkflowSettingsDocumentSchema = z.object({
	workflow: WorkflowGlobalSettingsSchema,
	runtime: RepositoryWorkflowRuntimeSettingsSchema,
	integration: RepositoryWorkflowIntegrationSettingsSchema,
	paths: RepositoryWorkflowPathSettingsSchema
}).strict();

export type RepositoryWorkflowRuntimeSettings = z.infer<typeof RepositoryWorkflowRuntimeSettingsSchema>;
export type RepositoryWorkflowIntegrationSettings = z.infer<typeof RepositoryWorkflowIntegrationSettingsSchema>;
export type RepositoryWorkflowPathSettings = z.infer<typeof RepositoryWorkflowPathSettingsSchema>;
export type RepositoryWorkflowSettingsDocument = z.infer<typeof RepositoryWorkflowSettingsDocumentSchema>;

const DEFAULT_REPOSITORY_WORKFLOW_SETTINGS_DOCUMENT: RepositoryWorkflowSettingsDocument = {
	workflow: createDefaultWorkflowSettings(),
	runtime: {
		agentRunner: 'copilot-cli'
	},
	integration: {
		trackingProvider: 'github'
	},
	paths: {
		missionWorkspaceRoot: DEFAULT_MISSION_WORKSPACE_ROOT,
		instructionsPath: '.agents',
		skillsPath: '.agents/skills'
	}
};

export function createDefaultRepositoryWorkflowSettingsDocument(): RepositoryWorkflowSettingsDocument {
	return structuredClone(DEFAULT_REPOSITORY_WORKFLOW_SETTINGS_DOCUMENT);
}

export function normalizeRepositoryWorkflowSettingsDocument(
	input: unknown,
	options: {
		defaultMissionWorkspaceRoot?: string;
	} = {}
): RepositoryWorkflowSettingsDocument {
	const defaults = createDefaultRepositoryWorkflowSettingsDocument();
	const source = isRecord(input) ? input : {};
	const runtime = isRecord(source['runtime']) ? source['runtime'] : {};
	const integration = isRecord(source['integration']) ? source['integration'] : {};
	const paths = isRecord(source['paths']) ? source['paths'] : {};
	const missionWorkspaceRoot = asNonEmptyString(paths['missionWorkspaceRoot'])
		?? options.defaultMissionWorkspaceRoot?.trim()
		?? defaults.paths.missionWorkspaceRoot;

	return RepositoryWorkflowSettingsDocumentSchema.parse({
		workflow: normalizeWorkflowSettings(source['workflow']),
		runtime: {
			agentRunner: asAgentRunner(runtime['agentRunner']) ?? defaults.runtime.agentRunner,
			...(asDefaultAgentMode(runtime['defaultAgentMode'])
				? { defaultAgentMode: asDefaultAgentMode(runtime['defaultAgentMode']) }
				: {}),
			...(asNonEmptyString(runtime['defaultModel'])
				? { defaultModel: asNonEmptyString(runtime['defaultModel']) }
				: {}),
			...(asNonEmptyString(runtime['towerTheme'])
				? { towerTheme: asNonEmptyString(runtime['towerTheme']) }
				: {})
		},
		integration: {
			trackingProvider: integration['trackingProvider'] === 'github'
				? 'github'
				: defaults.integration.trackingProvider
		},
		paths: {
			missionWorkspaceRoot,
			instructionsPath: asNonEmptyString(paths['instructionsPath']) ?? defaults.paths.instructionsPath,
			skillsPath: asNonEmptyString(paths['skillsPath']) ?? defaults.paths.skillsPath
		}
	});
}

function normalizeWorkflowSettings(input: unknown): WorkflowGlobalSettings {
	return WorkflowGlobalSettingsSchema.parse({
		...createDefaultWorkflowSettings(),
		...(isRecord(input) ? input : {})
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asAgentRunner(value: unknown): RepositoryWorkflowRuntimeSettings['agentRunner'] | undefined {
	return value === 'copilot-cli' || value === 'pi' ? value : undefined;
}

function asDefaultAgentMode(value: unknown): RepositoryWorkflowRuntimeSettings['defaultAgentMode'] {
	return value === 'interactive' || value === 'autonomous' ? value : undefined;
}