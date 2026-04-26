import { Entity } from '../Entity.js';
import type {
	GitHubIssueDetail,
	GitHubVisibleRepository,
	MissionBrief,
	OperatorActionListSnapshot,
	TrackedIssueSummary,
	RepositoryCandidate
} from '../../types.js';
import {
	readRepositoryPlatform
} from '../../lib/daemonConfig.js';
import {
	listRegisteredRepositories,
	registerMissionRepo
} from '../../lib/config.js';
import { deriveRepositoryIdentity } from '../../lib/repositoryIdentity.js';
import { refreshSystemStatus } from '../../system/SystemStatus.js';
import type {
	ControlGitHubIssueDetail,
	ControlGitHubRepositoriesClone,
} from '../../daemon/protocol/contracts.js';
import {
	repositorySchema,
	type RepositoryData,
	type RepositoryStateSnapshot
} from './RepositorySchema.js';
import {
	createRepositoryPlatformAdapter,
	resolveRepositoryPlatformRepository,
	type RepositoryBranchSyncStatus,
	type RepositoryPlatformAdapter
} from './PlatformAdapter.js';

export class Repository extends Entity<RepositoryData, string, OperatorActionListSnapshot> {
	public static fromCandidate(candidate: RepositoryCandidate): Repository {
		return new Repository(repositorySchema.parse({
			repositoryId: candidate.repositoryId,
			repositoryRootPath: candidate.repositoryRootPath,
			label: candidate.label,
			description: candidate.description,
			...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
		}));
	}

	public static read(repositoryRootPath: string): Repository {
		const identity = deriveRepositoryIdentity(repositoryRootPath);
		return new Repository(repositorySchema.parse({
			repositoryId: identity.repositoryId,
			repositoryRootPath: identity.repositoryRootPath,
			label: identity.githubRepository?.split('/').pop() ?? identity.repositoryRootPath.split('/').pop() ?? identity.repositoryRootPath,
			description: identity.githubRepository ?? identity.repositoryRootPath,
			...(identity.githubRepository ? { githubRepository: identity.githubRepository } : {})
		}));
	}

	public static async find(): Promise<Repository[]> {
		return (await listRegisteredRepositories()).map((candidate) => Repository.fromCandidate(candidate));
	}

	public static fromStateSnapshot(snapshot: RepositoryStateSnapshot): Repository {
		const repository = new Repository(snapshot.repository ?? snapshot.data);
		const availableCommands = snapshot.availableCommands ?? snapshot.commands;
		if (availableCommands) {
			repository.replaceAvailableActionsSnapshot(availableCommands);
		}
		return repository;
	}

	public constructor(snapshot: RepositoryData) {
		super(repositorySchema.parse(snapshot));
	}

	public get id(): string {
		return this.repositoryId;
	}

	public get repositoryId(): string {
		return this.data.repositoryId;
	}

	public get repositoryRootPath(): string {
		return this.data.repositoryRootPath;
	}

	public get label(): string {
		return this.data.label;
	}

	public get description(): string {
		return this.data.description;
	}

	public get githubRepository(): string | undefined {
		return this.data.githubRepository;
	}

	public get summary(): RepositoryData {
		return this.toSnapshot();
	}

	public listAvailableActionsSnapshot(): OperatorActionListSnapshot | undefined {
		return this.commands;
	}

	public replaceAvailableActionsSnapshot(snapshot: OperatorActionListSnapshot): this {
		this.commands = snapshot;
		return this;
	}

	public async listOpenIssues(limit = 50, authToken?: string): Promise<TrackedIssueSummary[]> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			return [];
		}

		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.listOpenIssues(boundedLimit);
	}

	public async listVisibleRepositories(authToken?: string): Promise<GitHubVisibleRepository[]> {
		const platformAdapter = this.resolvePlatformAdapter(authToken);
		if (!platformAdapter) {
			return [];
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.listVisibleRepositories();
	}

	public async getIssueDetail(
		params: ControlGitHubIssueDetail,
		authToken?: string
	): Promise<GitHubIssueDetail> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		const issueNumber = Number.isFinite(params.issueNumber) ? Math.floor(params.issueNumber) : NaN;
		if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
			throw new Error('GitHub issue detail requires a positive issue number.');
		}

		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.fetchIssueDetail(String(issueNumber));
	}

	public async cloneRepository(
		params: ControlGitHubRepositoriesClone,
		authToken?: string
	): Promise<Repository> {
		const platformAdapter = this.resolvePlatformAdapter(authToken);
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		const githubRepository = params.githubRepository?.trim();
		const destinationPath = params.destinationPath?.trim();
		if (!githubRepository) {
			throw new Error('GitHub repository clone requires a repository name.');
		}
		if (!destinationPath) {
			throw new Error('GitHub repository clone requires a destination path.');
		}
		if (!destinationPath.startsWith('/')) {
			throw new Error('GitHub repository clone requires an absolute destination path on the daemon host.');
		}

		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		const repositoryRootPath = await platformAdapter.cloneRepository({
			repository: githubRepository,
			destinationPath
		});
		await registerMissionRepo(repositoryRootPath);
		const registeredRepository = (await listRegisteredRepositories()).find(
			(candidate) => candidate.repositoryRootPath === repositoryRootPath
		);
		if (!registeredRepository) {
			throw new Error(`Mission could not register cloned repository '${githubRepository}'.`);
		}
		return Repository.fromCandidate(registeredRepository);
	}

	public async createMissionIssueBrief(input: {
		title: string;
		body: string;
	}, authToken?: string): Promise<MissionBrief> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.createIssue(input);
	}

	public async fetchMissionIssueBrief(issueNumber: number, authToken?: string): Promise<MissionBrief> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requirePlatformAuthentication(normalizedToken);
		if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
			throw new Error('GitHub issue detail requires a positive issue number.');
		}
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.fetchIssue(String(issueNumber));
	}

	public getWorkspaceBranchSyncStatus(input: {
		workspaceRoot: string;
		branchRef: string;
		repository?: string;
		ghBinary?: string;
	}): RepositoryBranchSyncStatus {
		const platform = readRepositoryPlatform(input.workspaceRoot, { resolveWorkspaceRoot: false });
		if (!platform) {
			throw new Error('Mission could not resolve a repository platform from .mission/settings.json.');
		}
		const adapter = createRepositoryPlatformAdapter({
			platform,
			workspaceRoot: input.workspaceRoot,
			...(input.repository ? { repository: input.repository } : {}),
			...(input.ghBinary ? { ghBinary: input.ghBinary } : {})
		});
		adapter.fetchRemote('origin');
		return adapter.getBranchSyncStatus(input.branchRef, 'origin');
	}

	public pullWorkspaceBranch(input: {
		workspaceRoot: string;
		branchRef: string;
		repository?: string;
		ghBinary?: string;
	}): void {
		const platform = readRepositoryPlatform(input.workspaceRoot, { resolveWorkspaceRoot: false });
		if (!platform) {
			throw new Error('Mission could not resolve a repository platform from .mission/settings.json.');
		}
		const adapter = createRepositoryPlatformAdapter({
			platform,
			workspaceRoot: input.workspaceRoot,
			...(input.repository ? { repository: input.repository } : {}),
			...(input.ghBinary ? { ghBinary: input.ghBinary } : {})
		});
		adapter.pullBranch(input.branchRef, 'origin');
	}

	private resolvePlatformAdapter(
		authToken?: string,
		options: {
			requireRepository?: boolean;
		} = {}
	): RepositoryPlatformAdapter | undefined {
		const platform = readRepositoryPlatform(this.repositoryRootPath, { resolveWorkspaceRoot: false });
		if (!platform) {
			return undefined;
		}

		const githubRepository = resolveRepositoryPlatformRepository(platform, this.repositoryRootPath);
		if (options.requireRepository && !githubRepository) {
			throw new Error('Mission could not resolve a GitHub repository from the current workspace.');
		}

		const normalizedToken = this.normalizeAuthToken(authToken);
		return createRepositoryPlatformAdapter({
			platform,
			workspaceRoot: this.repositoryRootPath,
			...(githubRepository ? { repository: githubRepository } : {}),
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
	}

	private requirePlatformAuthentication(authToken?: string): void {
		if (authToken) {
			return;
		}

		const systemStatus = refreshSystemStatus({ cwd: this.repositoryRootPath });
		if (!systemStatus.github.authenticated) {
			throw new Error(systemStatus.github.detail ?? 'GitHub CLI authentication is required.');
		}
	}

	private normalizeAuthToken(authToken?: string): string | undefined {
		const normalizedToken = authToken?.trim();
		return normalizedToken && normalizedToken.length > 0 ? normalizedToken : undefined;
	}
}

export type {
	RepositoryData as RepositorySummary,
	RepositoryStateSnapshot
};