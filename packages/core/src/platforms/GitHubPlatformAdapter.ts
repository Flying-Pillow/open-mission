import { spawn, spawnSync } from 'node:child_process';
import type { MissionBrief, MissionType, TrackedIssueSummary } from '../types.js';

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
		private readonly repository?: string
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

	private async runJsonProcess<T>(args: string[]): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const child = spawn('gh', args, {
				cwd: this.workspaceRoot,
				env: process.env,
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