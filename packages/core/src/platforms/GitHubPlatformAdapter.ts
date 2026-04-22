import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getMissionGitHubCliBinary } from '../lib/config.js';
import type { GitHubIssueDetail, GitHubVisibleRepository, MissionBrief, MissionType, TrackedIssueSummary } from '../types.js';

export type GitHubBranchSyncStatus = {
	branchRef: string;
	trackingRef?: string;
	status: 'up-to-date' | 'behind' | 'ahead' | 'diverged' | 'untracked';
	aheadCount: number;
	behindCount: number;
	localHead?: string;
	remoteHead?: string;
};

export function resolveGitHubRepositoryFromWorkspace(workspaceRoot: string): string | undefined {
	const remoteNames = runGitLines(workspaceRoot, ['remote']);
	const orderedRemoteNames = ['origin', ...remoteNames.filter((name) => name !== 'origin')];
	for (const remoteName of orderedRemoteNames) {
		const remoteUrl = runGitOutput(workspaceRoot, ['remote', 'get-url', remoteName]);
		const repository = parseGitHubRepositoryFromRemote(remoteUrl);
		if (repository) {
			return repository;
		}
	}
	return undefined;
}

type GitHubIssuePayload = {
	number: number;
	title: string;
	body?: string;
	url?: string;
	labels?: Array<{ name?: string }>;
	updatedAt?: string;
	assignees?: Array<{ login?: string }>;
};

type GitHubRepositoryPayload = {
	full_name?: string;
	html_url?: string;
	private?: boolean;
	archived?: boolean;
	owner?: {
		login?: string;
	};
};

function mapLabelsToMissionType(labels: string[]): MissionType | undefined {
	const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
	if (normalizedLabels.includes('bug')) {
		return 'fix';
	}
	if (normalizedLabels.includes('enhancement')) {
		return 'feature';
	}
	if (normalizedLabels.includes('documentation')) {
		return 'docs';
	}
	return undefined;
}

export class GitHubPlatformAdapter {
	public constructor(
		private readonly workspaceRoot: string,
		private readonly repository?: string,
		private readonly options: { authToken?: string; ghBinary?: string } = {}
	) { }

	public async fetchIssue(issueId: string): Promise<MissionBrief> {
		const payload = await this.runJsonProcess<GitHubIssuePayload>([
			'issue',
			'view',
			issueId,
			'--json',
			'number,title,body,url,labels',
			...(this.repository ? ['--repo', this.repository] : [])
		]);

		return this.mapIssuePayloadToBrief(payload);
	}

	public async fetchIssueDetail(issueId: string): Promise<GitHubIssueDetail> {
		const payload = await this.runJsonProcess<GitHubIssuePayload>([
			'issue',
			'view',
			issueId,
			'--json',
			'number,title,body,url,labels,updatedAt,assignees',
			...(this.repository ? ['--repo', this.repository] : [])
		]);

		return this.mapIssuePayloadToDetail(payload);
	}

	public async listOpenIssues(limit = 50): Promise<TrackedIssueSummary[]> {
		const payload = await this.runJsonProcess<GitHubIssuePayload[]>([
			'issue',
			'list',
			'--state',
			'open',
			'--limit',
			String(limit),
			'--json',
			'number,title,labels,assignees,url,updatedAt',
			...(this.repository ? ['--repo', this.repository] : [])
		]);

		return payload.map((issue) => ({
			number: issue.number,
			title: issue.title,
			url: issue.url ?? '',
			...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
			labels: (issue.labels ?? [])
				.map((label) => String(label.name ?? '').trim())
				.filter(Boolean),
			assignees: (issue.assignees ?? [])
				.map((assignee) => String(assignee.login ?? '').trim())
				.filter(Boolean)
		}));
	}

	public async listVisibleRepositories(): Promise<GitHubVisibleRepository[]> {
		const payload = await this.runJsonProcess<GitHubRepositoryPayload[][]>([
			'api',
			'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
			'--paginate',
			'--slurp'
		]);

		const repositories = new Map<string, GitHubVisibleRepository>();
		for (const page of payload) {
			for (const repository of page) {
				const fullName = repository.full_name?.trim();
				if (!fullName) {
					continue;
				}
				repositories.set(fullName.toLowerCase(), {
					fullName,
					...(repository.owner?.login?.trim()
						? { ownerLogin: repository.owner.login.trim() }
						: {}),
					...(repository.html_url?.trim()
						? { htmlUrl: repository.html_url.trim() }
						: {}),
					visibility: repository.private ? 'private' : 'public',
					archived: Boolean(repository.archived)
				});
			}
		}

		return [...repositories.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
	}

	public async cloneRepository(input: {
		repository: string;
		destinationPath: string;
	}): Promise<string> {
		const repository = input.repository.trim();
		const destinationPath = input.destinationPath.trim();
		if (!repository) {
			throw new Error('GitHub repository clone requires a repository name.');
		}
		if (!destinationPath) {
			throw new Error('GitHub repository clone requires a destination path.');
		}

		const resolvedDestinationPath = resolveCloneDestinationPath(repository, destinationPath);
		await fs.mkdir(path.dirname(resolvedDestinationPath), { recursive: true });
		await this.runTextProcess(['repo', 'clone', repository, resolvedDestinationPath]);
		return resolvedDestinationPath;
	}

	public async createIssue(input: {
		title: string;
		body: string;
	}): Promise<MissionBrief> {
		if (!this.repository) {
			throw new Error('GitHub issue creation requires a resolved repository.');
		}

		const payload = await this.runJsonProcess<GitHubIssuePayload>([
			'api',
			`repos/${this.repository}/issues`,
			'-f',
			`title=${input.title}`,
			'-f',
			`body=${input.body}`
		]);

		return this.mapIssuePayloadToBrief(payload);
	}

	public async createPullRequest(input: {
		title: string;
		body: string;
		headBranch: string;
		baseBranch?: string;
	}): Promise<string> {
		const output = await this.runTextProcess([
			'pr',
			'create',
			'--title',
			input.title,
			'--body',
			input.body,
			'--head',
			input.headBranch,
			...(input.baseBranch ? ['--base', input.baseBranch] : []),
			...(this.repository ? ['--repo', this.repository] : [])
		]);

		const url = output
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => /^https:\/\//u.test(line));
		return url ?? output.trim();
	}

	public async mergePullRequest(input: {
		pullRequest: string;
		method?: 'merge' | 'squash' | 'rebase';
		deleteBranch?: boolean;
	}): Promise<void> {
		const strategy = input.method ?? 'merge';
		await this.runTextProcess([
			'pr',
			'merge',
			input.pullRequest,
			`--${strategy}`,
			...(input.deleteBranch === false ? [] : ['--delete-branch']),
			...(this.repository ? ['--repo', this.repository] : [])
		]);
	}

	public fetchRemote(remoteName = 'origin'): void {
		const normalizedRemoteName = remoteName.trim();
		if (!normalizedRemoteName) {
			throw new Error('GitHub remote fetch requires a remote name.');
		}

		assertGit(this.workspaceRoot, ['fetch', '--prune', normalizedRemoteName]);
	}

	public getBranchSyncStatus(branchRef: string, remoteName = 'origin'): GitHubBranchSyncStatus {
		const normalizedBranchRef = branchRef.trim();
		const normalizedRemoteName = remoteName.trim();
		if (!normalizedBranchRef) {
			throw new Error('GitHub branch sync status requires a branch ref.');
		}
		if (!normalizedRemoteName) {
			throw new Error('GitHub branch sync status requires a remote name.');
		}

		const trackingRef = `refs/remotes/${normalizedRemoteName}/${normalizedBranchRef}`;
		const remoteHead = runGitOutput(this.workspaceRoot, ['rev-parse', '--verify', trackingRef]);
		if (!remoteHead) {
			return {
				branchRef: normalizedBranchRef,
				trackingRef,
				status: 'untracked',
				aheadCount: 0,
				behindCount: 0
			};
		}

		const localHead = runGitOutput(this.workspaceRoot, ['rev-parse', 'HEAD']);
		if (!localHead) {
			throw new Error(`GitHub branch sync status could not resolve HEAD for '${normalizedBranchRef}'.`);
		}

		const counts = runGitOutput(this.workspaceRoot, ['rev-list', '--left-right', '--count', `HEAD...${trackingRef}`]);
		const [aheadRaw, behindRaw] = counts.split(/\s+/u).filter(Boolean);
		const aheadCount = Number.parseInt(aheadRaw ?? '0', 10);
		const behindCount = Number.parseInt(behindRaw ?? '0', 10);
		if (Number.isNaN(aheadCount) || Number.isNaN(behindCount)) {
			throw new Error(`GitHub branch sync status returned invalid counts for '${normalizedBranchRef}'.`);
		}

		const status = behindCount > 0
			? (aheadCount > 0 ? 'diverged' : 'behind')
			: (aheadCount > 0 ? 'ahead' : 'up-to-date');

		return {
			branchRef: normalizedBranchRef,
			trackingRef,
			status,
			aheadCount,
			behindCount,
			localHead,
			remoteHead
		};
	}

	public pullBranch(branchRef: string, remoteName = 'origin'): void {
		const normalizedBranchRef = branchRef.trim();
		const normalizedRemoteName = remoteName.trim();
		if (!normalizedBranchRef) {
			throw new Error('GitHub branch pull requires a branch ref.');
		}
		if (!normalizedRemoteName) {
			throw new Error('GitHub branch pull requires a remote name.');
		}

		assertGit(this.workspaceRoot, ['pull', '--ff-only', normalizedRemoteName, normalizedBranchRef]);
	}

	private mapIssuePayloadToBrief(payload: GitHubIssuePayload): MissionBrief {
		const labels = (payload.labels ?? [])
			.map((label) => String(label.name ?? '').trim())
			.filter(Boolean);
		const type = mapLabelsToMissionType(labels) ?? 'task';

		return {
			issueId: payload.number,
			title: payload.title,
			body: payload.body?.trim() || 'Issue body not captured yet.',
			type,
			...(payload.url ? { url: payload.url } : {}),
			...(labels.length > 0 ? { labels } : {})
		} satisfies MissionBrief;
	}

	private mapIssuePayloadToDetail(payload: GitHubIssuePayload): GitHubIssueDetail {
		return {
			number: payload.number,
			title: payload.title,
			body: payload.body?.trim() || 'Issue body not captured yet.',
			...(payload.url ? { url: payload.url } : {}),
			...(payload.updatedAt ? { updatedAt: payload.updatedAt } : {}),
			labels: (payload.labels ?? [])
				.map((label) => String(label.name ?? '').trim())
				.filter(Boolean),
			assignees: (payload.assignees ?? [])
				.map((assignee) => String(assignee.login ?? '').trim())
				.filter(Boolean)
		};
	}

	private async runJsonProcess<T>(args: string[]): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const child = spawn(this.resolveGhBinary(), args, {
				cwd: this.workspaceRoot,
				env: this.buildProcessEnv(),
				stdio: ['ignore', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.once('error', (error) => {
				reject(error);
			});

			child.once('close', (code) => {
				if (code !== 0) {
					reject(new Error(stderr.trim() || `gh exited with code ${String(code ?? 'unknown')}.`));
					return;
				}

				try {
					resolve(JSON.parse(stdout) as T);
				} catch (error) {
					reject(
						new Error(
							`gh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
						)
					);
				}
			});
		});
	}

	private async runTextProcess(args: string[]): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const child = spawn(this.resolveGhBinary(), args, {
				cwd: this.workspaceRoot,
				env: this.buildProcessEnv(),
				stdio: ['ignore', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.once('error', (error) => {
				reject(error);
			});

			child.once('close', (code) => {
				if (code !== 0) {
					reject(new Error(stderr.trim() || `gh exited with code ${String(code ?? 'unknown')}.`));
					return;
				}

				resolve(stdout.trim());
			});
		});
	}

	private buildProcessEnv(): NodeJS.ProcessEnv {
		const authToken = this.options.authToken?.trim();
		if (!authToken) {
			return process.env;
		}

		return {
			...process.env,
			GH_TOKEN: authToken,
			GITHUB_TOKEN: authToken
		};
	}

	private resolveGhBinary(): string {
		return this.options.ghBinary?.trim() || getMissionGitHubCliBinary() || 'gh';
	}
}

function runGitLines(workspaceRoot: string, args: string[]): string[] {
	const output = runGitOutput(workspaceRoot, args);
	if (!output) {
		return [];
	}
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function runGitOutput(workspaceRoot: string, args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	});
	return result.status === 0 ? result.stdout.trim() : '';
}

function assertGit(workspaceRoot: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
}

function parseGitHubRepositoryFromRemote(remoteUrl: string): string | undefined {
	const normalized = remoteUrl.trim();
	if (!normalized) {
		return undefined;
	}
	const sshMatch = normalized.match(/^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u);
	if (sshMatch?.groups?.['owner'] && sshMatch.groups['repo']) {
		return `${sshMatch.groups['owner']}/${sshMatch.groups['repo']}`;
	}
	const sshProtocolMatch = normalized.match(/^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u);
	if (sshProtocolMatch?.groups?.['owner'] && sshProtocolMatch.groups['repo']) {
		return `${sshProtocolMatch.groups['owner']}/${sshProtocolMatch.groups['repo']}`;
	}
	const httpsMatch = normalized.match(/^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?(?:\/)?$/u);
	if (httpsMatch?.groups?.['owner'] && httpsMatch.groups['repo']) {
		return `${httpsMatch.groups['owner']}/${httpsMatch.groups['repo']}`;
	}
	return undefined;
}

function resolveCloneDestinationPath(repository: string, destinationPath: string): string {
	const [owner, repo, ...rest] = repository
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
	if (!owner || !repo || rest.length > 0) {
		throw new Error(`GitHub repository '${repository}' is invalid.`);
	}
	return path.resolve(destinationPath, owner, repo);
}