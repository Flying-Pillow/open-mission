import type {
	MissionSelectionCandidate,
	RepositoryCandidate
} from '../types.js';

export type MissionReference = {
	missionId: string;
	title: string;
	branchRef: string;
	createdAt: string;
	issueId?: number;
};

export type Repository = {
	repositoryId: string;
	repositoryRootPath: string;
	label: string;
	description: string;
	githubRepository?: string;
};

export function toMissionReference(candidate: MissionSelectionCandidate): MissionReference {
	return {
		missionId: candidate.missionId,
		title: candidate.title,
		branchRef: candidate.branchRef,
		createdAt: candidate.createdAt,
		...(candidate.issueId !== undefined ? { issueId: candidate.issueId } : {})
	};
}

export function toRepository(candidate: RepositoryCandidate): Repository {
	return {
		repositoryId: candidate.repositoryId,
		repositoryRootPath: candidate.repositoryRootPath,
		label: candidate.label,
		description: candidate.description,
		...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
	};
}
