import { z } from 'zod/v4';
import { DEFAULT_MISSION_WORKSPACE_ROOT } from './RepositoryPaths.js';
import {
    WorkflowGlobalSettingsSchema
} from '../../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';

export const RepositoryWorkflowAgentSettingsSchema = z.object({
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

export const RepositorySettingsSchema = z.object({
    workflow: WorkflowGlobalSettingsSchema,
    agent: RepositoryWorkflowAgentSettingsSchema,
    integration: RepositoryWorkflowIntegrationSettingsSchema,
    paths: RepositoryWorkflowPathSettingsSchema
}).strict();

export type RepositoryWorkflowAgentSettings = z.infer<typeof RepositoryWorkflowAgentSettingsSchema>;
export type RepositoryWorkflowIntegrationSettings = z.infer<typeof RepositoryWorkflowIntegrationSettingsSchema>;
export type RepositoryWorkflowPathSettings = z.infer<typeof RepositoryWorkflowPathSettingsSchema>;
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;

const DEFAULT_REPOSITORY_SETTINGS: RepositorySettings = {
    workflow: createDefaultWorkflowSettings(),
    agent: {
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

export function createDefaultRepositorySettings(): RepositorySettings {
    return structuredClone(DEFAULT_REPOSITORY_SETTINGS);
}