import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { Mission, MissionWorkflowBindings } from '../Mission/Mission.js';
import {
	getMissionGitHubCliBinary,
	readMissionConfig,
	resolveRepositoriesRoot
} from '../../lib/config.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { resolveGitHubRepositoryFromWorkspace } from '../../platforms/GitHubPlatformAdapter.js';
import { refreshSystemStatus } from '../../system/SystemStatus.js';
import type { MissionBrief, MissionDescriptor, MissionPreparationStatus } from '../../types.js';
import { resolveGitWorkspaceRoot } from '../../lib/workspacePaths.js';
import {
	RepositorySnapshotSchema,
	RepositoryDataSchema,
	RepositoryInputSchema,
	repositoryEntityName,
	RepositoryWorkflowConfigurationSchema,
	createDefaultRepositoryConfiguration,
	GitHubIssueDetailSchema,
	TrackedIssueSummarySchema,
	type RepositoryPlatformRepositoryType,
	type RepositorySnapshotType,
	type RepositoryDataType,
	type RepositoryInputType,
	type GitHubIssueDetailType,
	type RepositoryMissionStartAcknowledgementType,
	type TrackedIssueSummaryType,
	type RepositoryFindPayloadType,
	type RepositoryFindAvailablePayloadType,
	type RepositoryGetIssuePayloadType,
	type RepositoryListIssuesPayloadType,
	type RepositoryReadPayloadType,
	type RepositoryAddPayloadType,
	type RepositoryPreparePayloadType,
	type RepositoryPrepareResultType,
	type RepositoryRemoveAcknowledgementType,
	type RepositoryRemovePayloadType,
	type RepositorySettingsType,
	type RepositoryStartMissionFromBriefPayloadType,
	type RepositoryStartMissionFromIssuePayloadType,
	RepositorySettingsSchema,
	createDefaultRepositorySettings,
	RepositoryFindPayloadSchema,
	RepositoryFindAvailablePayloadSchema,
	RepositoryGetIssuePayloadSchema,
	RepositoryIdentityPayloadSchema,
	RepositoryListIssuesPayloadSchema,
	RepositoryMissionStartAcknowledgementSchema,
	RepositoryPreparePayloadSchema,
	RepositoryPrepareResultSchema,
	RepositoryReadPayloadSchema,
	RepositoryAddPayloadSchema,
	RepositoryRemoveAcknowledgementSchema,
	RepositoryRemovePayloadSchema,
	RepositoryLocalAddInputSchema,
	RepositoryStartMissionFromBriefPayloadSchema,
	RepositoryStartMissionFromIssuePayloadSchema
} from './RepositorySchema.js';
import type { WorkflowGlobalSettings } from '../../workflow/WorkflowSchema.js';
import { normalizeWorkflowSettings } from '../../settings/validation.js';
import {
	createRepositoryPlatformAdapter,
	type RepositoryPlatformKind
} from './PlatformAdapter.js';

export type RepositoryIdentity = {
	id: string;
	repositoryRootPath: string;
	platformRepositoryRef?: string;
};

export type RepositoryScaffolding = {
	controlDirectoryPath: string;
	settingsDocumentPath: string;
	workflowDirectoryPath: string;
	workflowDefinitionPath: string;
	workflowTemplatesPath: string;
	worktreesRoot: string;
};

export class Repository extends Entity<RepositoryDataType, string> {
	public static override readonly entityName = repositoryEntityName;
	public static readonly missionDirectoryName = '.mission';
	public static readonly defaultMissionsRoot = 'missions';
	public static readonly missionWorkflowDirectoryName = 'workflow';
	public static readonly missionWorkflowDefinitionFileName = 'workflow.json';

	public static async find(
		input: RepositoryFindPayloadType = {},
		_context?: EntityExecutionContext
	): Promise<RepositorySnapshotType[]> {
		RepositoryFindPayloadSchema.parse(input);
		const repositoriesById = new Map<string, Repository>();

		for (const repository of await Repository.discoverConfiguredRepositories()) {
			repositoriesById.set(repository.id, repository);
		}

		return await Promise.all(
			[...repositoriesById.values()].map((repository) =>
				repository.read({
					id: repository.id,
					repositoryRootPath: repository.repositoryRootPath
				})
			)
		);
	}

	public static async findAvailable(
		input: RepositoryFindAvailablePayloadType = {},
		context?: EntityExecutionContext
	): Promise<RepositoryPlatformRepositoryType[]> {
		const payload = RepositoryFindAvailablePayloadSchema.parse(input);
		const platform = payload.platform ?? 'github';
		const ghBinary = getMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform,
			workspaceRoot: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return await adapter.listRepositories();
	}

	private static async discoverConfiguredRepositories(): Promise<Repository[]> {
		const config = readMissionConfig();
		if (!config) {
			return [];
		}

		const repositoriesRoot = resolveRepositoriesRoot(config);
		const repositoryRootPaths = await Repository.findGitRepositoryRoots(repositoriesRoot);
		return repositoryRootPaths.map((repositoryRootPath) => Repository.open(repositoryRootPath));
	}

	private static async findGitRepositoryRoots(rootPath: string): Promise<string[]> {
		const discovered = new Set<string>();

		async function visit(directoryPath: string, remainingDepth: number): Promise<void> {
			if (remainingDepth < 0) {
				return;
			}

			try {
				const directoryEntries = await fsp.readdir(directoryPath, { withFileTypes: true });
				if (directoryEntries.some((entry) => entry.name === '.git')) {
					discovered.add(path.resolve(directoryPath));
					return;
				}

				await Promise.all(
					directoryEntries
						.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
						.map((entry) => visit(path.join(directoryPath, entry.name), remainingDepth - 1))
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
					return;
				}
				throw error;
			}
		}

		await visit(rootPath, 3);
		return [...discovered].sort((left, right) => left.localeCompare(right));
	}

	public static async add(
		input: RepositoryAddPayloadType,
		context?: EntityExecutionContext
	): Promise<RepositorySnapshotType> {
		const payload = RepositoryAddPayloadSchema.parse(input);
		const repositoryRootPath = 'repositoryRef' in payload
			? await Repository.checkoutPlatformRepository(payload, context)
			: payload.repositoryPath;
		const repository = await Repository.addLocalRepository(repositoryRootPath, context);
		return await repository.read({
			id: repository.id,
			repositoryRootPath: repository.repositoryRootPath
		});
	}

	public static async resolve(input: unknown, context?: EntityExecutionContext): Promise<Repository> {
		const inputRecord: Record<string, unknown> = Repository.isRecord(input) ? input : {};
		const payload = RepositoryIdentityPayloadSchema.parse({
			id: inputRecord['id'],
			...(typeof inputRecord['repositoryRootPath'] === 'string'
				? { repositoryRootPath: inputRecord['repositoryRootPath'] }
				: {})
		});
		const discoveredRepository = (await Repository.discoverConfiguredRepositories())
			.find((repository) => repository.id === payload.id);
		if (discoveredRepository) {
			return discoveredRepository;
		}

		const repository = await Repository.getRepositoryFactory(context).read(Repository, payload.id);
		if (!repository) {
			throw new Error(`Repository '${payload.id}' could not be resolved.`);
		}
		return repository;
	}

	public static create(input: RepositoryInputType): Repository {
		return new Repository(Repository.createRepositoryData(RepositoryInputSchema.parse(input)));
	}

	public static open(
		repositoryRootPath: string,
		input: Partial<Omit<RepositoryInputType, 'repositoryRootPath'>> = {}
	): Repository {
		return Repository.create({
			repositoryRootPath,
			...input
		});
	}

	public static deriveIdentity(repositoryRootPath: string): RepositoryIdentity {
		const normalizedRepositoryRootPath = path.resolve(repositoryRootPath);
		const platformRepositoryRef = Repository.normalizeGitHubRepositoryName(
			resolveGitHubRepositoryFromWorkspace(normalizedRepositoryRootPath)
		);
		if (platformRepositoryRef) {
			return {
				id: Repository.buildGitHubRepositoryId(platformRepositoryRef),
				repositoryRootPath: normalizedRepositoryRootPath,
				platformRepositoryRef
			};
		}

		return {
			id: Repository.buildLocalRepositoryId(normalizedRepositoryRootPath),
			repositoryRootPath: normalizedRepositoryRootPath
		};
	}

	public static buildGitHubRepositoryId(githubRepository: string): string {
		const normalizedRepository = Repository.normalizeGitHubRepositoryName(githubRepository);
		if (!normalizedRepository) {
			throw new Error(`GitHub repository '${githubRepository}' is invalid.`);
		}
		return `repository:github/${normalizedRepository}`;
	}

	public static slugIdentitySegment(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	public static getMissionDirectoryPath(repositoryRootPath: string): string {
		return path.join(repositoryRootPath, Repository.missionDirectoryName);
	}

	public static getMissionCatalogPath(repositoryRootPath: string): string {
		return path.join(Repository.getMissionDirectoryPath(repositoryRootPath), 'missions');
	}

	public static getMissionWorkflowPath(repositoryRootPath: string): string {
		return path.join(Repository.getMissionDirectoryPath(repositoryRootPath), Repository.missionWorkflowDirectoryName);
	}

	public static getMissionWorkflowDefinitionPath(repositoryRootPath: string): string {
		return path.join(Repository.getMissionWorkflowPath(repositoryRootPath), Repository.missionWorkflowDefinitionFileName);
	}

	public static getMissionWorkflowTemplatesPath(repositoryRootPath: string): string {
		return path.join(Repository.getMissionWorkflowPath(repositoryRootPath), 'templates');
	}

	public static getMissionControlRootFromMissionDir(missionDir: string): string {
		return path.resolve(missionDir, '..', '..', '..');
	}

	public static resolveMissionsRoot(
		configuredRoot = Repository.defaultMissionsRoot
	): string {
		const normalizedRoot = configuredRoot.trim() || Repository.defaultMissionsRoot;
		const configuredMissionsPath = process.env['MISSIONS_PATH']?.trim();
		if (normalizedRoot === Repository.defaultMissionsRoot && configuredMissionsPath) {
			return path.resolve(configuredMissionsPath);
		}
		if (path.isAbsolute(normalizedRoot)) {
			return path.resolve(normalizedRoot);
		}
		if (normalizedRoot === '~') {
			return os.homedir();
		}
		if (normalizedRoot.startsWith(`~${path.sep}`)) {
			return path.join(os.homedir(), normalizedRoot.slice(2));
		}
		return path.resolve(os.homedir(), normalizedRoot);
	}

	public static getMissionWorktreesPath(
		repositoryRootPath: string,
		options: { missionsRoot?: string } = {}
	): string {
		const githubRepository = resolveGitHubRepositoryFromWorkspace(repositoryRootPath);
		if (githubRepository) {
			const [owner, repository] = githubRepository
				.split('/')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0);
			if (owner && repository) {
				return path.join(
					Repository.resolveMissionsRoot(options.missionsRoot),
					owner,
					repository
				);
			}
		}

		return path.join(
			Repository.resolveMissionsRoot(options.missionsRoot),
			path.basename(path.resolve(repositoryRootPath))
		);
	}

	public static getMissionDaemonRoot(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): string {
		const resolvedControlRoot = options.resolveWorkspaceRoot === false
			? path.resolve(repositoryRootPath.trim())
			: Repository.resolveMissionControlRoot(repositoryRootPath);
		return Repository.getMissionDirectoryPath(resolvedControlRoot);
	}

	public static getWorkflowSettingsDocumentPath(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): string {
		return path.join(Repository.getMissionDaemonRoot(repositoryRootPath, options), 'workflow', 'workflow.json');
	}

	public static getSettingsDocumentPath(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): string {
		return path.join(Repository.getMissionDaemonRoot(repositoryRootPath, options), 'settings.json');
	}

	public static readPlatform(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): RepositoryPlatformKind | undefined {
		const settingsPath = Repository.getSettingsDocumentPath(repositoryRootPath, options);
		try {
			const content = fs.readFileSync(settingsPath, 'utf8').trim();
			if (!content) {
				return undefined;
			}
			const source = JSON.parse(content) as unknown;
			if (!source || typeof source !== 'object' || Array.isArray(source)) {
				return undefined;
			}
			const platform = (source as { platform?: unknown }).platform;
			return platform === 'github' ? platform : undefined;
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
				return undefined;
			}
			throw error;
		}
	}

	public static resolveSettingsDocument(input: unknown = {}): RepositorySettingsType {
		return RepositorySettingsSchema.parse(input);
	}

	public static readSettingsDocument(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): RepositorySettingsType | undefined {
		const settingsPath = Repository.getSettingsDocumentPath(repositoryRootPath, options);
		try {
			const content = fs.readFileSync(settingsPath, 'utf8').trim();
			if (!content) {
				return undefined;
			}
			return Repository.resolveSettingsDocument(JSON.parse(content) as unknown);
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
				return undefined;
			}
			throw error;
		}
	}

	public static requireSettingsDocument(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): RepositorySettingsType {
		const document = Repository.readSettingsDocument(repositoryRootPath, options);
		if (!document) {
			throw new Error(`Repository settings document '${Repository.getSettingsDocumentPath(repositoryRootPath, options)}' is required.`);
		}
		return document;
	}

	public static async ensureSettingsDocument(repositoryRootPath = process.cwd()): Promise<RepositorySettingsType> {
		const currentDocument = Repository.readSettingsDocument(repositoryRootPath);
		if (currentDocument) {
			return currentDocument;
		}

		return Repository.writeSettingsDocument(createDefaultRepositorySettings(), repositoryRootPath);
	}

	public static async writeSettingsDocument(
		document: RepositorySettingsType,
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): Promise<RepositorySettingsType> {
		const settingsPath = Repository.getSettingsDocumentPath(repositoryRootPath, options);
		const nextDocument = Repository.resolveSettingsDocument(document);
		const temporarySettingsPath = `${settingsPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
		await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
		await fsp.writeFile(temporarySettingsPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8');
		await fsp.rename(temporarySettingsPath, settingsPath);
		return nextDocument;
	}

	public static async initializeScaffolding(repositoryRootPath: string): Promise<RepositoryScaffolding> {
		const { WorkflowSettingsStore } = await import('../../settings/index.js');
		const controlDirectoryPath = Repository.getMissionDirectoryPath(repositoryRootPath);
		const settingsDocumentPath = Repository.getSettingsDocumentPath(repositoryRootPath, {
			resolveWorkspaceRoot: false
		});
		const worktreesRoot = Repository.getMissionWorktreesPath(repositoryRootPath);

		await fsp.mkdir(controlDirectoryPath, { recursive: true });
		await new WorkflowSettingsStore(repositoryRootPath).initialize();
		const workflowDirectoryPath = path.join(controlDirectoryPath, 'workflow');
		const workflowDefinitionPath = path.join(workflowDirectoryPath, 'workflow.json');
		const workflowTemplatesPath = path.join(workflowDirectoryPath, 'templates');

		return {
			controlDirectoryPath,
			settingsDocumentPath,
			workflowDirectoryPath,
			workflowDefinitionPath,
			workflowTemplatesPath,
			worktreesRoot
		};
	}

	private static async addLocalRepository(repositoryPath: string, context?: EntityExecutionContext): Promise<Repository> {
		const { repositoryPath: trimmedRepositoryPath } = RepositoryLocalAddInputSchema.parse({ repositoryPath });
		const controlRoot = resolveGitWorkspaceRoot(trimmedRepositoryPath);
		if (!controlRoot) {
			throw new Error(`Mission could not resolve a Git repository from '${repositoryPath}'.`);
		}

		const repository = Repository.open(controlRoot);
		return Repository.getRepositoryFactory(context).save(Repository, repository.toData());
	}

	private static async checkoutPlatformRepository(
		input: Extract<RepositoryAddPayloadType, { repositoryRef: string }>,
		context?: EntityExecutionContext
	): Promise<string> {
		const ghBinary = getMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform: input.platform,
			workspaceRoot: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return adapter.cloneRepository({
			repositoryRef: input.repositoryRef,
			destinationPath: input.destinationPath
		});
	}

	public constructor(data: RepositoryDataType) {
		super(RepositoryDataSchema.parse(data));
	}

	public get id(): string {
		return this.data.id;
	}

	public get repositoryRootPath(): string {
		return this.data.repositoryRootPath;
	}

	public get ownerId(): string {
		return this.data.ownerId;
	}

	public get repoName(): string {
		return this.data.repoName;
	}

	public get platformRepositoryRef(): string | undefined {
		return this.data.platformRepositoryRef;
	}

	public get settings(): RepositorySettingsType {
		return structuredClone(this.data.settings);
	}

	public get workflowConfiguration(): WorkflowGlobalSettings {
		return structuredClone(this.data.workflowConfiguration);
	}

	public get isInitialized(): boolean {
		return this.data.isInitialized;
	}

	public updateSettings(settings: RepositorySettingsType): this {
		this.data = RepositoryDataSchema.parse({
			...this.data,
			settings: RepositorySettingsSchema.parse(settings)
		});
		return this;
	}

	public updateWorkflowConfiguration(workflowConfiguration: WorkflowGlobalSettings): this {
		this.data = RepositoryDataSchema.parse({
			...this.data,
			workflowConfiguration: RepositoryWorkflowConfigurationSchema.parse(workflowConfiguration)
		});
		return this;
	}

	public markInitialized(value = true): this {
		this.data = RepositoryDataSchema.parse({
			...this.data,
			isInitialized: value
		});
		return this;
	}

	public toSchema(): RepositoryDataType {
		return this.toData();
	}

	public canStartMissionFromIssue(): boolean {
		return this.platformRepositoryRef !== undefined;
	}

	public canStartMissionFromBrief(): boolean {
		return true;
	}

	public canRemove(): boolean {
		return true;
	}

	public async prepare(
		input: RepositoryPreparePayloadType,
		context?: EntityExecutionContext
	): Promise<RepositoryPrepareResultType> {
		this.assertRepositoryIdentity(RepositoryPreparePayloadSchema.parse(input));
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			throw new Error(`Repository '${this.id}' does not have a GitHub remote configured.`);
		}

		const store = new FilesystemAdapter(this.repositoryRootPath);
		const branchRef = store.deriveRepositoryBootstrapBranchName();
		const baseBranch = store.getDefaultBranch();
		const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-bootstrap-'));
		const proposalWorktreePath = path.join(temporaryRoot, 'bootstrap');

		try {
			await store.materializeLinkedWorktree(proposalWorktreePath, branchRef, baseBranch);
			const initialization = await Repository.initializeScaffolding(proposalWorktreePath);

			const proposalStore = new FilesystemAdapter(proposalWorktreePath);
			proposalStore.stagePaths([
				path.relative(proposalWorktreePath, initialization.settingsDocumentPath),
				path.relative(proposalWorktreePath, initialization.workflowDirectoryPath)
			], proposalWorktreePath, { force: true });
			proposalStore.commit(Repository.buildBootstrapCommitMessage(), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			refreshSystemStatus({ cwd: proposalWorktreePath });
			const pullRequestUrl = await this.requireRepositoryPlatformAdapter(context?.authToken)
				.createPullRequest({
					title: 'Initialize Mission repository scaffolding',
					body: Repository.buildBootstrapPullRequestBody(branchRef),
					headBranch: branchRef,
					baseBranch
				});

			return RepositoryPrepareResultSchema.parse({
				kind: 'repository-bootstrap',
				state: 'pull-request-opened',
				branchRef,
				baseBranch,
				pullRequestUrl,
				controlDirectoryPath: Repository.getMissionDirectoryPath(this.repositoryRootPath),
				settingsPath: Repository.getSettingsDocumentPath(this.repositoryRootPath),
				worktreesPath: Repository.getMissionWorktreesPath(this.repositoryRootPath),
				missionsPath: Repository.getMissionCatalogPath(this.repositoryRootPath)
			});
		} finally {
			await store.removeLinkedWorktree(proposalWorktreePath).catch(() => undefined);
			await fsp.rm(temporaryRoot, { recursive: true, force: true });
		}
	}

	public override async remove(
		input: RepositoryRemovePayloadType,
		context?: EntityExecutionContext
	): Promise<RepositoryRemoveAcknowledgementType> {
		const payload = RepositoryRemovePayloadSchema.parse(input);
		this.assertRepositoryIdentity(payload);
		await this.getEntityFactory(context).remove(Repository, this.id);
		return RepositoryRemoveAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'remove',
			id: this.id
		});
	}

	public async read(input: RepositoryReadPayloadType): Promise<RepositorySnapshotType> {
		this.assertRepositoryIdentity(RepositoryReadPayloadSchema.parse(input));
		const store = new FilesystemAdapter(this.repositoryRootPath);
		const settings = Repository.readSettingsDocument(this.repositoryRootPath);
		const missions = await store.listMissions().catch(() => []);
		const currentBranch = store.isGitRepository() ? store.getCurrentBranch() : undefined;

		return RepositorySnapshotSchema.parse({
			repository: this.toSchema(),
			operationalMode: settings ? 'repository' : 'setup',
			controlRoot: this.repositoryRootPath,
			...(currentBranch ? { currentBranch } : {}),
			settingsComplete: settings !== undefined,
			...(this.platformRepositoryRef ? { platformRepositoryRef: this.platformRepositoryRef } : {}),
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
		input: RepositoryListIssuesPayloadType,
		context?: { authToken?: string }
	): Promise<TrackedIssueSummaryType[]> {
		this.assertRepositoryIdentity(RepositoryListIssuesPayloadSchema.parse(input));
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
		return TrackedIssueSummarySchema.array().parse(platform ? await platform.listOpenIssues(25) : []);
	}

	public async getIssue(
		input: RepositoryGetIssuePayloadType,
		context?: { authToken?: string }
	): Promise<GitHubIssueDetailType> {
		const payload = RepositoryGetIssuePayloadSchema.parse(input);
		this.assertRepositoryIdentity(payload);
		return GitHubIssueDetailSchema.parse(
			await this.requireRepositoryPlatformAdapter(context?.authToken)
				.fetchIssueDetail(String(payload.issueNumber))
		);
	}

	public async startMissionFromIssue(
		input: RepositoryStartMissionFromIssuePayloadType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		const payload = RepositoryStartMissionFromIssuePayloadSchema.parse(input);
		this.assertRepositoryIdentity(payload);
		const brief = await this.requireRepositoryPlatformAdapter(context?.authToken)
			.fetchIssue(String(payload.issueNumber));
		return this.prepareMission(brief, 'startMissionFromIssue');
	}

	public async startMissionFromBrief(
		input: RepositoryStartMissionFromBriefPayloadType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		const payload = RepositoryStartMissionFromBriefPayloadSchema.parse(input);
		this.assertRepositoryIdentity(payload);
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
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

		return this.prepareMission(brief, 'startMissionFromBrief');
	}

	private async prepareMission(
		brief: MissionBrief,
		method: 'startMissionFromIssue' | 'startMissionFromBrief'
	): Promise<RepositoryMissionStartAcknowledgementType> {
		const { readMissionWorkflowDefinition } = await import('../../workflow/mission/preset.js');
		const settings = Repository.requireSettingsDocument(this.repositoryRootPath);
		const workflowDocument = readMissionWorkflowDefinition(this.repositoryRootPath);
		if (!workflowDocument) {
			throw new Error(`Repository workflow definition '${Repository.getMissionWorkflowDefinitionPath(this.repositoryRootPath)}' is required.`);
		}
		const workflow = normalizeWorkflowSettings(
			workflowDocument
		);
		const store = new FilesystemAdapter(this.repositoryRootPath);
		const preparation = await this.prepareMissionFromBrief(store, {
			workflow,
			taskRunners: new Map(),
			...(settings.instructionsPath
				? { instructionsPath: Repository.resolveRepositoryPath(this.repositoryRootPath, settings.instructionsPath) }
				: {}),
			...(settings.skillsPath
				? { skillsPath: Repository.resolveRepositoryPath(this.repositoryRootPath, settings.skillsPath) }
				: {}),
			...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
			...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {})
		}, { brief });

		if (preparation.kind !== 'mission') {
			throw new Error('Mission preparation returned an unexpected result.');
		}

		return RepositoryMissionStartAcknowledgementSchema.parse({
			ok: true,
			entity: 'Repository',
			method,
			id: preparation.missionId
		});
	}

	private async prepareMissionFromBrief(
		store: FilesystemAdapter,
		workflowBindings: MissionWorkflowBindings,
		input: {
			brief: MissionBrief;
			branchRef?: string;
		}
	): Promise<MissionPreparationStatus> {
		const missionId = store.createMissionId(input.brief);
		const canonicalMissionRootDir = store.getTrackedMissionDir(missionId);
		const branchRef = input.branchRef
			?? (input.brief.issueId !== undefined
				? store.deriveMissionBranchName(input.brief.issueId, input.brief.title)
				: store.deriveDraftMissionBranchName(input.brief.title));
		const baseBranch = store.getDefaultBranch();
		const createdAt = new Date().toISOString();
		const proposalWorktreePath = store.getMissionWorktreePath(missionId);
		let preparedMission: Mission | undefined;

		try {
			await store.materializeMissionWorktree(proposalWorktreePath, branchRef, baseBranch);

			const proposalStore = new FilesystemAdapter(proposalWorktreePath);
			const initialization = Repository.readSettingsDocument(proposalWorktreePath)
				? undefined
				: await Repository.initializeScaffolding(proposalWorktreePath);
			const missionRootDir = proposalStore.getTrackedMissionDir(missionId, proposalWorktreePath);
			const existingDescriptor = await proposalStore.readMissionDescriptor(missionRootDir);
			if (existingDescriptor) {
				return {
					kind: 'mission',
					state: 'branch-prepared',
					missionId,
					branchRef: existingDescriptor.branchRef,
					baseBranch,
					worktreePath: proposalWorktreePath,
					missionRootDir,
					...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
					...(input.brief.url ? { issueUrl: input.brief.url } : {})
				};
			}

			const descriptor: MissionDescriptor = {
				missionId,
				missionDir: missionRootDir,
				brief: input.brief,
				branchRef,
				createdAt
			};

			const { Mission } = await import('../Mission/Mission.js');
			preparedMission = Mission.hydrate(
				proposalStore,
				missionRootDir,
				descriptor,
				workflowBindings
			);
			await preparedMission.initialize();
			preparedMission.dispose();
			preparedMission = undefined;

			proposalStore.stagePaths(
				[
					...(initialization
						? [
							path.relative(proposalWorktreePath, initialization.settingsDocumentPath),
							path.relative(proposalWorktreePath, initialization.workflowDirectoryPath)
						]
						: []),
					path.relative(proposalWorktreePath, missionRootDir)
				],
				proposalWorktreePath,
				{ force: true }
			);
			proposalStore.commit(Repository.buildMissionPreparationCommitMessage(missionId, input.brief), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			return {
				kind: 'mission',
				state: 'branch-prepared',
				missionId,
				branchRef,
				baseBranch,
				worktreePath: proposalWorktreePath,
				missionRootDir: canonicalMissionRootDir,
				...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
				...(input.brief.url ? { issueUrl: input.brief.url } : {})
			};
		} finally {
			preparedMission?.dispose();
		}
	}

	private tryCreateRepositoryPlatformAdapter(authToken?: string) {
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			return undefined;
		}

		const ghBinary = getMissionGitHubCliBinary();
		return createRepositoryPlatformAdapter({
			platform: 'github',
			workspaceRoot: this.repositoryRootPath,
			repository: platformRepositoryRef,
			...(authToken ? { authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});
	}

	private requireRepositoryPlatformAdapter(authToken?: string) {
		const adapter = this.tryCreateRepositoryPlatformAdapter(authToken);
		if (!adapter) {
			throw new Error(`Repository '${this.id}' does not have a GitHub remote configured.`);
		}
		return adapter;
	}

	private assertRepositoryIdentity(input: { id: string; repositoryRootPath?: string | undefined }): void {
		if (input.id !== this.id) {
			throw new Error(`Repository payload id '${input.id}' does not match '${this.id}'.`);
		}

		if (input.repositoryRootPath && path.resolve(input.repositoryRootPath) !== this.repositoryRootPath) {
			throw new Error(`Repository payload root '${input.repositoryRootPath}' does not match '${this.repositoryRootPath}'.`);
		}
	}

	private static createRepositoryData(input: RepositoryInputType): RepositoryDataType {
		const normalizedRepositoryRootPath = path.resolve(input.repositoryRootPath);
		const identity = Repository.deriveIdentity(normalizedRepositoryRootPath);
		const explicitPlatformRepositoryRef = input.platformRepositoryRef?.trim();
		const platformRepositoryRef = explicitPlatformRepositoryRef || identity.platformRepositoryRef;
		const { ownerId, repoName } = Repository.deriveRepositoryNames(normalizedRepositoryRootPath, platformRepositoryRef);
		const defaults = createDefaultRepositoryConfiguration();

		return RepositoryDataSchema.parse({
			id: platformRepositoryRef ? Repository.buildGitHubRepositoryId(platformRepositoryRef) : identity.id,
			repositoryRootPath: normalizedRepositoryRootPath,
			ownerId,
			repoName,
			...(platformRepositoryRef ? { platformRepositoryRef } : {}),
			settings: input.settings ?? defaults.settings,
			workflowConfiguration: input.workflowConfiguration ?? defaults.workflowConfiguration,
			isInitialized: input.isInitialized ?? defaults.isInitialized
		});
	}

	private static isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private static deriveRepositoryNames(
		repositoryRootPath: string,
		platformRepositoryRef?: string
	): { ownerId: string; repoName: string } {
		const segments = platformRepositoryRef?.split('/').map((segment) => segment.trim()).filter(Boolean) ?? [];
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

	private static resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
		return path.isAbsolute(configuredPath)
			? configuredPath
			: path.join(repositoryRootPath, configuredPath);
	}

	private static normalizeGitHubRepositoryName(value: string | undefined): string | undefined {
		const [owner, repository, ...rest] = value?.trim().split('/').map((segment) => segment.trim()) ?? [];
		if (!owner || !repository || rest.length > 0) {
			return undefined;
		}
		return `${owner}/${repository}`;
	}

	private static buildLocalRepositoryId(repositoryRootPath: string): string {
		const repositoryLabel = Repository.slugIdentitySegment(path.basename(repositoryRootPath) || 'repository') || 'repository';
		const repositoryHash = createHash('sha1').update(repositoryRootPath).digest('hex').slice(0, 8);
		return `repository:local/${repositoryLabel}/${repositoryHash}`;
	}

	private static resolveMissionControlRoot(repositoryRootPath: string): string {
		const normalizedRoot = repositoryRootPath.trim();
		const resolvedRoot = resolveGitWorkspaceRoot(normalizedRoot);
		return resolvedRoot ?? path.resolve(normalizedRoot);
	}

	private static buildBootstrapCommitMessage(): string {
		return 'chore(mission): initialize repository scaffolding';
	}

	private static buildMissionPreparationCommitMessage(missionId: string, brief: MissionBrief): string {
		return `chore(mission): prepare ${missionId}${brief.issueId !== undefined ? ` for #${String(brief.issueId)}` : ''}`;
	}

	private static buildBootstrapPullRequestBody(branchRef: string): string {
		return [
			'## Repository Bootstrap',
			'',
			'This PR initializes the tracked Mission repository scaffolding.',
			'',
			`- Branch: \`${branchRef}\``,
			'- Creates `.mission/settings.json` as the repository settings document.',
			'- Creates `.mission/workflow/workflow.json` as the repository workflow definition.',
			'- Creates `.mission/workflow/templates/` as the repository-owned workflow preset.',
			'- Establishes repo-scoped Mission control settings.',
			'- Leaves branch-owned `.mission/missions/<mission-id>` content to mission branches.',
			'',
			'After merge, pull the default branch before preparing a mission.'
		].join('\n');
	}

	private static getRepositoryFactory(context?: EntityExecutionContext) {
		const factory = Repository.getEntityFactory(context);
		if (!factory.has(Repository)) {
			factory.register({
				entityName: repositoryEntityName,
				table: 'repository',
				entityClass: Repository,
				storageSchema: RepositoryDataSchema,
				getId: (record) => record.id
			});
		}
		return factory;
	}
}

export type {
	RepositoryDataType,
	RepositoryInputType
};