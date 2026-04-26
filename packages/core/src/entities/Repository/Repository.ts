import * as path from 'node:path';
import { findRegisteredRepositoryById, listRegisteredRepositories } from '../../lib/config.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { readRepositorySettingsDocument } from '../../lib/daemonConfig.js';
import { MissionPreparationService } from '../../mission/MissionPreparationService.js';
import { GitHubPlatformAdapter } from '../../platforms/GitHubPlatformAdapter.js';
import { repositorySnapshotSchema } from '../../airport/runtime.js';
import type { RepositorySnapshot } from '../../airport/runtime.js';
import type { MissionBrief } from '../../types.js';
import { deriveRepositoryIdentity } from '../../lib/repositoryIdentity.js';
import {
	repositorySchema,
	repositoryInputSchema,
	repositoryWorkflowConfigurationSchema,
	createDefaultRepositoryConfiguration,
	type RepositoryData,
	type RepositoryInput
} from './RepositorySchema.js';
import {
	RepositorySettingsSchema,
	type RepositorySettings
} from './RepositorySettings.js';
import type { WorkflowGlobalSettings } from '../../workflow/WorkflowSchema.js';
import { createDefaultRepositorySettings } from './RepositorySettings.js';
import { readMissionWorkflowDefinition } from '../../workflow/mission/preset.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { normalizeWorkflowSettings } from '../../settings/validation.js';
import {
	type RepositoryFindPayload,
	type RepositoryGetIssuePayload,
	type RepositoryListIssuesPayload,
	type RepositoryReadPayload,
	type RepositoryStartMissionFromBriefPayload,
	type RepositoryStartMissionFromIssuePayload,
	repositoryFindPayloadSchema,
	repositoryGetIssuePayloadSchema,
	repositoryIdentityPayloadSchema,
	repositoryListIssuesPayloadSchema,
	repositoryMissionMutationStatusSchema,
	repositoryReadPayloadSchema,
	repositoryStartMissionFromBriefPayloadSchema,
	repositoryStartMissionFromIssuePayloadSchema
} from './RepositoryRemote.js';

export class Repository {
	private snapshot: RepositoryData;

	public static async find(
		input: RepositoryFindPayload = {},
		_context?: { authToken?: string }
	): Promise<RepositorySnapshot[]> {
		repositoryFindPayloadSchema.parse(input);
		const repositories = (await listRegisteredRepositories()).map((candidate) =>
			Repository.open(candidate.repositoryRootPath, {
				label: candidate.label,
				description: candidate.description,
				...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
			})
		);

		return await Promise.all(
			repositories.map((repository) =>
				repository.read({
					repositoryId: repository.repositoryId,
					repositoryRootPath: repository.repositoryRootPath
				})
			)
		);
	}

	public static async resolve(input: unknown): Promise<Repository | undefined> {
		const payload = repositoryIdentityPayloadSchema.parse(input);
		const candidate = await findRegisteredRepositoryById(payload.repositoryId);
		if (candidate) {
			return Repository.open(candidate.repositoryRootPath, {
				label: candidate.label,
				description: candidate.description,
				...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
			});
		}

		return payload.repositoryRootPath?.trim()
			? Repository.open(payload.repositoryRootPath.trim())
			: undefined;
	}

	public static register(input: RepositoryInput): Repository {
		return new Repository(createRepositoryData(repositoryInputSchema.parse(input)));
	}

	public static open(
		repositoryRootPath: string,
		input: Partial<Omit<RepositoryInput, 'repositoryRootPath'>> = {}
	): Repository {
		return Repository.register({
			repositoryRootPath,
			...input
		});
	}

	public constructor(snapshot: RepositoryData) {
		this.snapshot = repositorySchema.parse(snapshot);
	}

	public get id(): string {
		return this.repositoryId;
	}

	public get repositoryId(): string {
		return this.snapshot.repositoryId;
	}

	public get repositoryRootPath(): string {
		return this.snapshot.repositoryRootPath;
	}

	public get ownerId(): string {
		return this.snapshot.ownerId;
	}

	public get repoName(): string {
		return this.snapshot.repoName;
	}

	public get label(): string {
		return this.snapshot.label;
	}

	public get description(): string {
		return this.snapshot.description;
	}

	public get githubRepository(): string | undefined {
		return this.snapshot.githubRepository;
	}

	public get settings(): RepositorySettings {
		return structuredClone(this.snapshot.settings);
	}

	public get workflowConfiguration(): WorkflowGlobalSettings {
		return structuredClone(this.snapshot.workflowConfiguration);
	}

	public get isInitialized(): boolean {
		return this.snapshot.isInitialized;
	}

	public updateSettings(settings: RepositorySettings): this {
		this.snapshot = repositorySchema.parse({
			...this.snapshot,
			settings: RepositorySettingsSchema.parse(settings)
		});
		return this;
	}

	public updateWorkflowConfiguration(workflowConfiguration: WorkflowGlobalSettings): this {
		this.snapshot = repositorySchema.parse({
			...this.snapshot,
			workflowConfiguration: repositoryWorkflowConfigurationSchema.parse(workflowConfiguration)
		});
		return this;
	}

	public markInitialized(value = true): this {
		this.snapshot = repositorySchema.parse({
			...this.snapshot,
			isInitialized: value
		});
		return this;
	}

	public toSchema(): RepositoryData {
		return structuredClone(this.snapshot);
	}

	public toJSON(): RepositoryData {
		return this.toSchema();
	}

	public async read(input: RepositoryReadPayload): Promise<RepositorySnapshot> {
		repositoryReadPayloadSchema.parse(input);
		const store = new FilesystemAdapter(this.repositoryRootPath);
		const settings = readRepositorySettingsDocument(this.repositoryRootPath);
		const missions = await store.listMissions().catch(() => []);
		const currentBranch = store.isGitRepository() ? store.getCurrentBranch() : undefined;

		return repositorySnapshotSchema.parse({
			repository: this.toSchema(),
			operationalMode: settings ? 'repository' : 'setup',
			controlRoot: this.repositoryRootPath,
			...(currentBranch ? { currentBranch } : {}),
			settingsComplete: settings !== undefined,
			...(this.githubRepository ? { githubRepository: this.githubRepository } : {}),
			missions: missions.map(({ descriptor }) => ({
				missionId: descriptor.missionId,
				title: descriptor.brief.title,
				branchRef: descriptor.branchRef,
				createdAt: descriptor.createdAt,
				...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
			}))
		});
	}

	public async listIssues(
		input: RepositoryListIssuesPayload,
		context?: { authToken?: string }
	): Promise<ReturnType<GitHubPlatformAdapter['listOpenIssues']>> {
		repositoryListIssuesPayloadSchema.parse(input);
		const platform = this.tryCreateGitHubPlatformAdapter(context?.authToken);
		return platform ? platform.listOpenIssues(25) : [];
	}

	public async getIssue(
		input: RepositoryGetIssuePayload,
		context?: { authToken?: string }
	) {
		const payload = repositoryGetIssuePayloadSchema.parse(input);
		return this.requireGitHubPlatformAdapter(context?.authToken)
			.fetchIssueDetail(String(payload.issueNumber));
	}

	public async startMissionFromIssue(
		input: RepositoryStartMissionFromIssuePayload,
		context?: { authToken?: string }
	) {
		const payload = repositoryStartMissionFromIssuePayloadSchema.parse(input);
		const brief = await this.requireGitHubPlatformAdapter(context?.authToken)
			.fetchIssue(String(payload.issueNumber));
		return this.prepareMission(brief);
	}

	public async startMissionFromBrief(
		input: RepositoryStartMissionFromBriefPayload,
		context?: { authToken?: string }
	) {
		const payload = repositoryStartMissionFromBriefPayloadSchema.parse(input);
		const platform = this.tryCreateGitHubPlatformAdapter(context?.authToken);
		const brief = platform
			? await platform.createIssue({
				title: payload.title,
				body: payload.body
			}).then((createdIssue) => ({
				...payload,
				...(createdIssue.issueId !== undefined ? { issueId: createdIssue.issueId } : {}),
				...(createdIssue.url ? { url: createdIssue.url } : {}),
				...(createdIssue.labels ? { labels: createdIssue.labels } : {})
			}))
			: payload;

		return this.prepareMission(brief);
	}

	private async prepareMission(brief: MissionBrief) {
		const settings = readRepositorySettingsDocument(this.repositoryRootPath) ?? createDefaultRepositorySettings();
		const workflow = normalizeWorkflowSettings(
			readMissionWorkflowDefinition(this.repositoryRootPath) ?? createDefaultWorkflowSettings()
		);
		const store = new FilesystemAdapter(this.repositoryRootPath);
		const preparation = await new MissionPreparationService(store, {
			workflow,
			taskRunners: new Map(),
			...(settings.instructionsPath
				? { instructionsPath: resolveRepositoryPath(this.repositoryRootPath, settings.instructionsPath) }
				: {}),
			...(settings.skillsPath
				? { skillsPath: resolveRepositoryPath(this.repositoryRootPath, settings.skillsPath) }
				: {}),
			...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
			...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {})
		}).prepareFromBrief({ brief });

		if (preparation.kind !== 'mission') {
			throw new Error('Mission preparation returned an unexpected result.');
		}

		return repositoryMissionMutationStatusSchema.parse({
			missionId: preparation.missionId
		});
	}

	private tryCreateGitHubPlatformAdapter(authToken?: string): GitHubPlatformAdapter | undefined {
		const githubRepository = this.githubRepository?.trim();
		if (!githubRepository) {
			return undefined;
		}

		return new GitHubPlatformAdapter(
			this.repositoryRootPath,
			githubRepository,
			authToken ? { authToken } : {}
		);
	}

	private requireGitHubPlatformAdapter(authToken?: string): GitHubPlatformAdapter {
		const adapter = this.tryCreateGitHubPlatformAdapter(authToken);
		if (!adapter) {
			throw new Error(`Repository '${this.repositoryId}' does not have a GitHub remote configured.`);
		}
		return adapter;
	}
}

function createRepositoryData(input: RepositoryInput): RepositoryData {
	const normalizedRepositoryRootPath = path.resolve(input.repositoryRootPath);
	const identity = deriveRepositoryIdentity(normalizedRepositoryRootPath);
	const githubRepository = input.githubRepository?.trim() || identity.githubRepository;
	const { ownerId, repoName } = deriveRepositoryNames(normalizedRepositoryRootPath, githubRepository);
	const defaults = createDefaultRepositoryConfiguration();

	return repositorySchema.parse({
		repositoryId: identity.repositoryId,
		repositoryRootPath: normalizedRepositoryRootPath,
		ownerId,
		repoName,
		label: input.label?.trim() || repoName,
		description: input.description ?? githubRepository ?? normalizedRepositoryRootPath,
		...(githubRepository ? { githubRepository } : {}),
		settings: input.settings ?? defaults.settings,
		workflowConfiguration: input.workflowConfiguration ?? defaults.workflowConfiguration,
		isInitialized: input.isInitialized ?? defaults.isInitialized
	});
}

function deriveRepositoryNames(
	repositoryRootPath: string,
	githubRepository?: string
): { ownerId: string; repoName: string } {
	const segments = githubRepository?.split('/').map((segment) => segment.trim()).filter(Boolean) ?? [];
	if (segments.length === 2) {
		return {
			ownerId: segments[0]!,
			repoName: segments[1]!
		};
	}

	return {
		ownerId: 'local',
		repoName: path.basename(repositoryRootPath) || 'repository'
	};
}

export type {
	RepositoryData,
	RepositoryInput
};

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
	return path.isAbsolute(configuredPath)
		? configuredPath
		: path.join(repositoryRootPath, configuredPath);
}