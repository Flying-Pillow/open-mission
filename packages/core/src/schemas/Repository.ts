import { z } from 'zod/v4';
import {
    RepositorySettingsSchema,
    createDefaultRepositorySettings
} from '../entities/Repository/RepositorySettings.js';
import { WorkflowGlobalSettingsSchema } from '../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';

export const repositoryWorkflowConfigurationSchema = WorkflowGlobalSettingsSchema;

export const repositoryInputSchema = z.object({
    repositoryRootPath: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    githubRepository: z.string().trim().min(1).optional(),
    settings: RepositorySettingsSchema.optional(),
    workflowConfiguration: repositoryWorkflowConfigurationSchema.optional(),
    isInitialized: z.boolean().optional()
}).strict();

export const repositorySchema = z.object({
    repositoryId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1),
    ownerId: z.string().trim().min(1),
    repoName: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string(),
    githubRepository: z.string().trim().min(1).optional(),
    settings: RepositorySettingsSchema,
    workflowConfiguration: repositoryWorkflowConfigurationSchema,
    isInitialized: z.boolean()
}).strict();

export type RepositoryInput = z.infer<typeof repositoryInputSchema>;
export type RepositoryData = z.infer<typeof repositorySchema>;

export function createDefaultRepositoryConfiguration(): Pick<RepositoryData, 'settings' | 'workflowConfiguration' | 'isInitialized'> {
    const settings = createDefaultRepositorySettings();
    return {
        settings,
        workflowConfiguration: createDefaultWorkflowSettings(),
        isInitialized: false
    };
}