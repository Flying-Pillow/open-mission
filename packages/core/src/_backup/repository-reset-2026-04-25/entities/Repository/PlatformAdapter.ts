import type {
	GitHubIssueDetail,
	GitHubVisibleRepository,
	MissionBrief,
	TrackedIssueSummary
} from '../../types.js';
import {
	GitHubPlatformAdapter,
	resolveGitHubRepositoryFromWorkspace,
	type GitHubBranchSyncStatus
} from '../../platforms/GitHubPlatformAdapter.js';

export type RepositoryPlatformKind = 'github';
export type RepositoryBranchSyncStatus = GitHubBranchSyncStatus;

export type RepositoryPlatformAdapterInput = {
	platform: RepositoryPlatformKind;
	workspaceRoot: string;
	repository?: string;
	authToken?: string;
	ghBinary?: string;
};

export type RepositoryPlatformCloneRequest = {
	repository: string;
	destinationPath: string;
};

export type RepositoryPlatformPullRequestRequest = {
	title: string;
	body: string;
	headBranch: string;
	baseBranch?: string;
};

export type RepositoryPlatformIssueCreateRequest = {
	title: string;
	body: string;
};

export interface RepositoryPlatformAdapter {
	readonly platform?: RepositoryPlatformKind;
	fetchIssue(issueId: string): Promise<MissionBrief>;
	listOpenIssues(limit: number): Promise<TrackedIssueSummary[]>;
	listVisibleRepositories(): Promise<GitHubVisibleRepository[]>;
	fetchIssueDetail(issueId: string): Promise<GitHubIssueDetail>;
	cloneRepository(input: RepositoryPlatformCloneRequest): Promise<string>;
	createIssue(input: RepositoryPlatformIssueCreateRequest): Promise<MissionBrief>;
	createPullRequest(input: RepositoryPlatformPullRequestRequest): Promise<string>;
	fetchRemote(remoteName?: string): void;
	getBranchSyncStatus(branchRef: string, remoteName?: string): GitHubBranchSyncStatus;
	pullBranch(branchRef: string, remoteName?: string): void;
}

export function resolveRepositoryPlatformRepository(
	platform: RepositoryPlatformKind,
	workspaceRoot: string
): string | undefined {
	switch (platform) {
		case 'github':
			return resolveGitHubRepositoryFromWorkspace(workspaceRoot);
	}
}

export function createRepositoryPlatformAdapter(
	input: RepositoryPlatformAdapterInput
): RepositoryPlatformAdapter {
	switch (input.platform) {
		case 'github':
			return new GitHubPlatformAdapter(
				input.workspaceRoot,
				input.repository,
				{
					...(input.authToken ? { authToken: input.authToken } : {}),
					...(input.ghBinary ? { ghBinary: input.ghBinary } : {})
				}
			);
	}
}