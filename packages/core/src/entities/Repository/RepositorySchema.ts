import { z } from 'zod/v4';
export {
	repositoryInputSchema,
	repositorySchema,
	repositoryWorkflowConfigurationSchema,
	createDefaultRepositoryConfiguration,
	type RepositoryData,
	type RepositoryInput
} from '../../schemas/Repository.js';

export const missionReferenceSchema = z.object({
	missionId: z.string().trim().min(1),
	title: z.string().trim().min(1),
	branchRef: z.string().trim().min(1),
	createdAt: z.string().trim().min(1),
	issueId: z.number().int().positive().optional()
});

export type MissionReference = z.infer<typeof missionReferenceSchema>;

export type RepositoryStateSnapshot = {
	repository: import('../../schemas/Repository.js').RepositoryData;
};