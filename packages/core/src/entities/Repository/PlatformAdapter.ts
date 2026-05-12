import type {
	MissionBrief
} from '../Mission/MissionSchema.js';
import type {
	RepositoryPlatformKindType,
	RepositoryPlatformOwnerType,
	RepositoryPlatformRepositoryType,
	RepositoryIssueDetailType,
	TrackedIssueSummaryType
} from './RepositorySchema.js';
import {
	GitHubPlatformAdapter,
	resolveGitHubRepositoryFromRepositoryRoot
} from '../../platforms/GitHubPlatformAdapter.js';

export type RepositoryBranchSyncStatus = {
	branchRef: string;
	trackingRef?: string;
	status: 'up-to-date' | 'behind' | 'ahead' | 'diverged' | 'untracked';
	aheadCount: number;
	behindCount: number;
	localHead?: string;
	remoteHead?: string;
};

export type RepositoryPlatformAdapterInput = {
	platform: RepositoryPlatformKindType;
	repositoryRootPath: string;
	repository?: string;
	authToken?: string;
	ghBinary?: string;
};

export type RepositoryPlatformCloneRequest = {
	repositoryRef: string;
	destinationPath: string;
};

export type RepositoryPlatformCreateRequest = {
	ownerLogin: string;
	repositoryName: string;
	destinationPath: string;
	visibility: 'private' | 'public' | 'internal';
};

export type RepositoryPlatformPullRequestRequest = {
	title: string;
	body: string;
	headBranch: string;
	baseBranch?: string;
};

export type RepositoryPlatformPullRequestMergeRequest = {
	pullRequest: string;
	method?: 'merge' | 'squash' | 'rebase';
	deleteBranch?: boolean;
	auto?: boolean;
};

export type RepositoryPlatformIssueCreateRequest = {
	title: string;
	body: string;
};

export interface RepositoryPlatformAdapter {
	readonly platform?: RepositoryPlatformKindType;
	fetchIssue(issueId: string): Promise<MissionBrief>;
	listOpenIssues(limit: number): Promise<TrackedIssueSummaryType[]>;
	listRepositories(): Promise<RepositoryPlatformRepositoryType[]>;
	listRepositoryOwners(): Promise<RepositoryPlatformOwnerType[]>;
	fetchIssueDetail(issueId: string): Promise<RepositoryIssueDetailType>;
	cloneRepository(input: RepositoryPlatformCloneRequest): Promise<string>;
	createRepository(input: RepositoryPlatformCreateRequest): Promise<string>;
	createIssue(input: RepositoryPlatformIssueCreateRequest): Promise<MissionBrief>;
	createPullRequest(input: RepositoryPlatformPullRequestRequest): Promise<string>;
	mergePullRequest(input: RepositoryPlatformPullRequestMergeRequest): Promise<void>;
	fetchRemote(remoteName?: string): void;
	getBranchSyncStatus(branchRef: string, remoteName?: string): RepositoryBranchSyncStatus;
	pullBranch(branchRef: string, remoteName?: string): void;
}

export function resolveRepositoryPlatformRepository(
	platform: RepositoryPlatformKindType,
	repositoryRootPath: string
): string | undefined {
	switch (platform) {
		case 'github':
			return resolveGitHubRepositoryFromRepositoryRoot(repositoryRootPath);
	}
}

export function createRepositoryPlatformAdapter(
	input: RepositoryPlatformAdapterInput
): RepositoryPlatformAdapter {
	switch (input.platform) {
		case 'github':
			return new GitHubPlatformAdapter(
				input.repositoryRootPath,
				input.repository,
				{
					...(input.authToken ? { authToken: input.authToken } : {}),
					...(input.ghBinary ? { ghBinary: input.ghBinary } : {})
				}
			);
	}
}