import { z } from 'zod/v4';
import type { OperatorActionListSnapshot } from '../../types.js';
import type { EntityStateSnapshot } from '../Entity.js';

export const repositorySchema = z.object({
	repositoryId: z.string().trim().min(1),
	repositoryRootPath: z.string().trim().min(1),
	label: z.string().trim().min(1),
	description: z.string(),
	githubRepository: z.string().trim().min(1).optional()
});

export const missionReferenceSchema = z.object({
	missionId: z.string().trim().min(1),
	title: z.string().trim().min(1),
	branchRef: z.string().trim().min(1),
	createdAt: z.string().trim().min(1),
	issueId: z.number().int().positive().optional()
});

export type RepositoryData = z.infer<typeof repositorySchema>;
export type MissionReference = z.infer<typeof missionReferenceSchema>;

export type RepositoryStateSnapshot = EntityStateSnapshot<RepositoryData, OperatorActionListSnapshot> & {
	repository: RepositoryData;
	availableCommands?: OperatorActionListSnapshot;
};