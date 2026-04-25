import {
	GitHubPlatformAdapter,
	resolveGitHubRepositoryFromWorkspace
} from '../../platforms/GitHubPlatformAdapter.js';
import type { RepositoryPlatformAdapter, RepositoryPlatformCloneRequest, RepositoryPlatformPullRequestRequest } from './PlatformAdapter.js';

export class GitHubRepositoryPlatformAdapter implements RepositoryPlatformAdapter {
	public readonly platform = 'github' as const;
	private readonly adapter: GitHubPlatformAdapter;

	public constructor(input: {
		workspaceRoot: string;
		repository?: string;
		authToken?: string;
		ghBinary?: string;
	}) {
		this.adapter = new GitHubPlatformAdapter(
			input.workspaceRoot,
			input.repository,
			{
				...(input.authToken ? { authToken: input.authToken } : {}),
				...(input.ghBinary ? { ghBinary: input.ghBinary } : {})
			}
		);
	}

	public static resolveRepository(workspaceRoot: string): string | undefined {
		return resolveGitHubRepositoryFromWorkspace(workspaceRoot);
	}

	public async fetchIssue(issueNumber: number) {
		return this.adapter.fetchIssue(String(issueNumber));
	}

	public async listOpenIssues(limit: number) {
		return this.adapter.listOpenIssues(limit);
	}

	public async listVisibleRepositories() {
		return this.adapter.listVisibleRepositories();
	}

	public async getIssueDetail(issueNumber: number) {
		return this.adapter.fetchIssueDetail(String(issueNumber));
	}

	public async cloneRepository(input: RepositoryPlatformCloneRequest) {
		return this.adapter.cloneRepository(input);
	}

	public async createIssue(input: { title: string; body: string; }) {
		return this.adapter.createIssue(input);
	}

	public async createPullRequest(input: RepositoryPlatformPullRequestRequest) {
		return this.adapter.createPullRequest(input);
	}

	public fetchRemote(remoteName = 'origin') {
		this.adapter.fetchRemote(remoteName);
	}

	public getBranchSyncStatus(branchRef: string, remoteName = 'origin') {
		return this.adapter.getBranchSyncStatus(branchRef, remoteName);
	}

	public pullBranch(branchRef: string, remoteName = 'origin') {
		this.adapter.pullBranch(branchRef, remoteName);
	}
}