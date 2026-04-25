import type {
	GitHubIssueDetail,
	GitHubVisibleRepository,
	MissionBrief,
	TrackedIssueSummary
} from '../../types.js';
import type { GitHubBranchSyncStatus } from '../../platforms/GitHubPlatformAdapter.js';

export type RepositoryPlatformKind = 'github';

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