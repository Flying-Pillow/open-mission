import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityClassCommandViewType, type EntityCommandViewType } from '../Entity/EntitySchema.js';
import { AgentRegistry } from '../Agent/AgentRegistry.js';
import type { Mission, MissionWorkflowBindings } from '../Mission/Mission.js';
import {
	getMissionGitHubCliBinary,
	readMissionConfig,
	resolveRepositoriesRoot
} from '../../settings/MissionInstall.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { resolveGitHubRepositoryFromRepositoryRoot } from '../../platforms/GitHubPlatformAdapter.js';
import { refreshSystemStatus } from '../../system/SystemStatus.js';
import type { MissionBrief, MissionDescriptor, MissionPreparationStatus } from '../Mission/MissionSchema.js';
import { resolveGitWorkspaceRoot } from '../../platforms/git/GitWorkspace.js';
import {
	RepositoryDataSchema,
	RepositoryStorageSchema,
	RepositoryInputSchema,
	repositoryEntityName,
	RepositoryWorkflowConfigurationSchema,
	createDefaultRepositoryConfiguration,
	RepositoryIssueDetailSchema,
	TrackedIssueSummarySchema,
	type RepositoryPlatformRepositoryType,
	type RepositoryDataType,
	type RepositoryStorageType,
	type RepositoryInputType,
	type RepositoryIssueDetailType,
	type RepositoryMissionStartAcknowledgementType,
	type TrackedIssueSummaryType,
	type RepositoryFindType,
	type RepositoryFindAvailableType,
	type RepositoryClassCommandsType,
	type RepositoryGetIssueType,
	type RepositoryLocatorType,
	type RepositoryAddType,
	type RepositoryRemoveAcknowledgementType,
	type RepositorySetupResultType,
	type RepositorySetupType,
	type RepositorySyncCommandAcknowledgementType,
	type RepositorySyncStatusType,
	type RepositorySettingsType,
	type RepositoryInvalidStateType,
	type RepositoryStartMissionFromBriefType,
	type RepositoryStartMissionFromIssueType,
	RepositorySettingsSchema,
	createDefaultRepositorySettings,
	RepositoryFindSchema,
	RepositoryFindAvailableSchema,
	RepositoryClassCommandsSchema,
	RepositoryGetIssueSchema,
	RepositoryLocatorSchema,
	RepositoryMissionStartAcknowledgementSchema,
	RepositoryAddSchema,
	RepositoryRemoveAcknowledgementSchema,
	RepositorySetupResultSchema,
	RepositorySetupSchema,
	RepositorySyncCommandAcknowledgementSchema,
	RepositorySyncStatusSchema,
	RepositoryLocalAddInputSchema,
	RepositoryStartMissionFromBriefSchema,
	RepositoryStartMissionFromIssueSchema
} from './RepositorySchema.js';
import type { WorkflowDefinition } from '../../workflow/WorkflowSchema.js';
import { parsePersistedWorkflowSettings } from '../../settings/validation.js';
import {
	createRepositoryPlatformAdapter,
	type RepositoryPlatformAdapter,
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

type RepositorySettingsDocumentState =
	| { kind: 'missing'; settingsPath: string }
	| { kind: 'valid'; settingsPath: string; settings: RepositorySettingsType }
	| { kind: 'invalid'; settingsPath: string; invalidState: RepositoryInvalidStateType };

export class Repository extends Entity<RepositoryDataType, string> {
	public static override readonly entityName = repositoryEntityName;
	public static readonly missionDirectoryName = '.mission';
	public static readonly defaultMissionsRoot = 'missions';
	public static readonly missionWorkflowDirectoryName = 'workflow';
	public static readonly missionWorkflowDefinitionFileName = 'workflow.json';

	public static async find(
		input: RepositoryFindType = {},
		_context?: EntityExecutionContext
	): Promise<RepositoryDataType[]> {
		RepositoryFindSchema.parse(input);
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
		input: RepositoryFindAvailableType = {},
		context?: EntityExecutionContext
	): Promise<RepositoryPlatformRepositoryType[]> {
		const args = RepositoryFindAvailableSchema.parse(input);
		const platform = args.platform ?? 'github';
		const ghBinary = getMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform,
			repositoryRootPath: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return await adapter.listRepositories();
	}

	public static async classCommands(
		input: RepositoryClassCommandsType = {},
		context?: EntityExecutionContext
	): Promise<EntityClassCommandViewType> {
		const args = RepositoryClassCommandsSchema.parse(input);
		const { RepositoryContract } = await import('./RepositoryContract.js');
		return EntityClassCommandViewSchema.parse({
			entity: repositoryEntityName,
			commands: await Repository.availableCommands(
				RepositoryContract,
				args.commandInput,
				{
					surfacePath: context?.surfacePath?.trim() || process.cwd(),
					...(context?.authToken ? { authToken: context.authToken } : {}),
					...(context?.entityFactory ? { entityFactory: context.entityFactory } : {})
				}
			)
		});
	}

	public static async canAdd(input?: unknown, context?: EntityExecutionContext) {
		const result = RepositoryAddSchema.safeParse(input ?? {});
		if (!result.success || !('repositoryRef' in result.data)) {
			return true;
		}

		const registeredRepository = await Repository.findRegisteredPlatformRepository(result.data.repositoryRef, context);
		return registeredRepository
			? { available: false, reason: `Repository '${result.data.repositoryRef}' is already checked out at '${registeredRepository.repositoryRootPath}'.` }
			: true;
	}

	public async canFetchExternalState(_context?: EntityExecutionContext) {
		if (!this.platformRepositoryRef?.trim()) {
			return { available: false, reason: 'Repository has no external platform repository ref.' };
		}
		if (!fs.existsSync(this.repositoryRootPath)) {
			return { available: false, reason: 'Repository root does not exist.' };
		}
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		return store.isGitRepository()
			? true
			: { available: false, reason: 'Repository root is not a Git worktree.' };
	}

	public async canFastForwardFromExternal(context?: EntityExecutionContext) {
		const status = this.buildSyncStatus(context?.authToken, { refreshExternalState: true });
		if (status.external.status !== 'behind') {
			return { available: false, reason: Repository.describeExternalSyncState(status) };
		}
		return true;
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

	private static async assertRemovableRepositoryRoot(repositoryRootPath: string): Promise<string> {
		const resolvedRepositoryRootPath = path.resolve(repositoryRootPath);
		if (resolvedRepositoryRootPath === path.parse(resolvedRepositoryRootPath).root) {
			throw new Error('Cannot remove the filesystem root as a Repository root.');
		}
		if (resolvedRepositoryRootPath === path.resolve(os.homedir())) {
			throw new Error('Cannot remove the operator home directory as a Repository root.');
		}

		const gitEntryPath = path.join(resolvedRepositoryRootPath, '.git');
		const gitEntry = await fsp.lstat(gitEntryPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				throw new Error(`Repository root '${resolvedRepositoryRootPath}' must contain a .git entry before it can be removed.`);
			}
			throw error;
		});
		if (!gitEntry.isDirectory() && !gitEntry.isFile()) {
			throw new Error(`Repository root '${resolvedRepositoryRootPath}' has an invalid .git entry.`);
		}

		return resolvedRepositoryRootPath;
	}

	public static async add(
		input: RepositoryAddType,
		context?: EntityExecutionContext
	): Promise<RepositoryDataType> {
		const args = RepositoryAddSchema.parse(input);
		const repositoryRootPath = 'repositoryRef' in args
			? await Repository.checkoutPlatformRepositoryAfterDuplicateCheck(args, context)
			: args.repositoryPath;
		const repository = await Repository.addLocalRepository(repositoryRootPath, context);
		return await repository.read({
			id: repository.id,
			repositoryRootPath: repository.repositoryRootPath
		});
	}

	public static async resolve(input: unknown, context?: EntityExecutionContext): Promise<Repository> {
		const inputRecord: Record<string, unknown> = Repository.isRecord(input) ? input : {};
		const args = RepositoryLocatorSchema.parse({
			id: inputRecord['id'],
			...(typeof inputRecord['repositoryRootPath'] === 'string'
				? { repositoryRootPath: inputRecord['repositoryRootPath'] }
				: {})
		});
		const discoveredRepository = (await Repository.discoverConfiguredRepositories())
			.find((repository) => repository.id === args.id);
		if (discoveredRepository) {
			return discoveredRepository;
		}

		const repository = await Repository.getRepositoryFactory(context).read(Repository, args.id);
		if (!repository) {
			throw new Error(`Repository '${args.id}' could not be resolved.`);
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
			resolveGitHubRepositoryFromRepositoryRoot(normalizedRepositoryRootPath)
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

	public static getRepositoryRootFromMissionDir(missionDir: string): string {
		return path.resolve(missionDir, '..', '..', '..');
	}

	public static resolveRepositoryRoot(startPath = process.cwd()): string {
		const normalizedStartPath = startPath.trim() || process.cwd();
		return resolveGitWorkspaceRoot(normalizedStartPath) ?? path.resolve(normalizedStartPath);
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
		const githubRepository = resolveGitHubRepositoryFromRepositoryRoot(repositoryRootPath);
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
		const resolvedRepositoryRoot = options.resolveWorkspaceRoot === false
			? path.resolve(repositoryRootPath.trim())
			: Repository.resolveRepositoryRoot(repositoryRootPath);
		return Repository.getMissionDirectoryPath(resolvedRepositoryRoot);
	}

	public static getSettingsDocumentPath(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): string {
		return path.join(Repository.getMissionDaemonRoot(repositoryRootPath, options), 'settings.json');
	}

	public static resolveSettingsDocument(input: unknown = {}): RepositorySettingsType {
		return RepositorySettingsSchema.parse(input);
	}

	private static inspectSettingsDocument(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): RepositorySettingsDocumentState {
		const settingsPath = Repository.getSettingsDocumentPath(repositoryRootPath, options);
		try {
			const content = fs.readFileSync(settingsPath, 'utf8').trim();
			if (!content) {
				return { kind: 'missing', settingsPath };
			}
			return {
				kind: 'valid',
				settingsPath,
				settings: Repository.resolveSettingsDocument(JSON.parse(content) as unknown)
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
				return { kind: 'missing', settingsPath };
			}
			return {
				kind: 'invalid',
				settingsPath,
				invalidState: {
					code: 'invalid-settings-document',
					path: settingsPath,
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}

	public static readSettingsDocument(
		repositoryRootPath = process.cwd(),
		options: { resolveWorkspaceRoot?: boolean } = {}
	): RepositorySettingsType | undefined {
		const documentState = Repository.inspectSettingsDocument(repositoryRootPath, options);
		if (documentState.kind === 'missing') {
			return undefined;
		}
		if (documentState.kind === 'invalid') {
			throw new Error(
				`Repository settings document '${documentState.settingsPath}' is invalid: ${documentState.invalidState.message}`
			);
		}
		return documentState.settings;
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

	public static async initializeScaffolding(
		repositoryRootPath: string,
		options: { settings?: RepositorySettingsType } = {}
	): Promise<RepositoryScaffolding> {
		const { WorkflowSettingsStore } = await import('../../settings/index.js');
		const controlDirectoryPath = Repository.getMissionDirectoryPath(repositoryRootPath);
		const settingsDocumentPath = Repository.getSettingsDocumentPath(repositoryRootPath, {
			resolveWorkspaceRoot: false
		});
		const worktreesRoot = Repository.getMissionWorktreesPath(repositoryRootPath);

		await fsp.mkdir(controlDirectoryPath, { recursive: true });
		await new WorkflowSettingsStore(repositoryRootPath).initialize({
			...(options.settings ? { settings: options.settings } : {})
		});
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
		const repositoryRoot = resolveGitWorkspaceRoot(trimmedRepositoryPath);
		if (!repositoryRoot) {
			throw new Error(`Mission could not resolve a Git repository from '${repositoryPath}'.`);
		}

		const repository = Repository.open(repositoryRoot);
		return Repository.getRepositoryFactory(context).save(Repository, repository.toStorage());
	}

	private static async checkoutPlatformRepositoryAfterDuplicateCheck(
		input: Extract<RepositoryAddType, { repositoryRef: string }>,
		context?: EntityExecutionContext
	): Promise<string> {
		await Repository.assertPlatformRepositoryIsNotRegistered(input.repositoryRef, context);
		const ghBinary = getMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform: input.platform,
			repositoryRootPath: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return adapter.cloneRepository({
			repositoryRef: input.repositoryRef,
			destinationPath: input.destinationPath
		});
	}

	private static async assertPlatformRepositoryIsNotRegistered(
		repositoryRef: string,
		context?: EntityExecutionContext
	): Promise<void> {
		const normalizedRepositoryRef = Repository.normalizeGitHubRepositoryName(repositoryRef);
		if (!normalizedRepositoryRef) {
			throw new Error(`Platform repository ref '${repositoryRef}' is invalid.`);
		}

		const registeredRepository = await Repository.findRegisteredPlatformRepository(normalizedRepositoryRef, context);
		if (registeredRepository) {
			throw new Error(`Repository '${normalizedRepositoryRef}' is already checked out at '${registeredRepository.repositoryRootPath}'.`);
		}
	}

	private static async findRegisteredPlatformRepository(
		repositoryRef: string,
		context?: EntityExecutionContext
	): Promise<Repository | undefined> {
		const normalizedRepositoryRef = Repository.normalizeGitHubRepositoryName(repositoryRef);
		if (!normalizedRepositoryRef) {
			return undefined;
		}

		const repositoryId = Repository.buildGitHubRepositoryId(normalizedRepositoryRef);
		const normalizedKey = normalizedRepositoryRef.toLowerCase();
		const discoveredRepository = (await Repository.discoverConfiguredRepositories())
			.find((repository) => repository.id === repositoryId
				|| repository.platformRepositoryRef?.trim().toLowerCase() === normalizedKey);
		if (discoveredRepository) {
			return discoveredRepository;
		}

		const factory = Repository.getRepositoryFactory(context);
		const storedRepository = await factory.read(Repository, repositoryId) ?? undefined;
		if (!storedRepository) {
			return undefined;
		}
		if (Repository.isLiveRepositoryRoot(storedRepository.repositoryRootPath)) {
			return storedRepository;
		}
		await factory.remove(Repository, storedRepository.id).catch(() => undefined);
		return undefined;
	}

	private static isLiveRepositoryRoot(repositoryRootPath: string): boolean {
		if (!fs.existsSync(repositoryRootPath)) {
			return false;
		}
		return new MissionDossierFilesystem(repositoryRootPath).isGitRepository();
	}

	public constructor(data: RepositoryStorageType) {
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

	public get workflowConfiguration(): WorkflowDefinition {
		return structuredClone(this.data.workflowConfiguration);
	}

	public get isInitialized(): boolean {
		return this.data.isInitialized;
	}

	public get invalidState(): RepositoryInvalidStateType | undefined {
		return this.data.invalidState ? structuredClone(this.data.invalidState) : undefined;
	}

	public updateSettings(settings: RepositorySettingsType): this {
		this.data = RepositoryDataSchema.parse({
			...this.data,
			settings: RepositorySettingsSchema.parse(settings)
		});
		return this;
	}

	public updateWorkflowConfiguration(workflowConfiguration: WorkflowDefinition): this {
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

	public toStorage(): RepositoryStorageType {
		const {
			operationalMode: _operationalMode,
			invalidState: _invalidState,
			currentBranch: _currentBranch,
			...storage
		} = this.toData();
		return RepositoryStorageSchema.parse(storage);
	}

	public canStartMissionFromIssue() {
		if (this.invalidState) {
			return this.unavailable(Repository.describeInvalidState(this.invalidState));
		}
		if (!this.platformRepositoryRef) {
			return this.unavailable('Repository does not have a platform repository ref.');
		}
		if (!this.isInitialized) {
			return this.unavailable('Repository control state is not initialized.');
		}
		return this.available();
	}

	public canStartMissionFromBrief() {
		if (this.invalidState) {
			return this.unavailable(Repository.describeInvalidState(this.invalidState));
		}
		return !this.isInitialized
			? this.unavailable('Repository control state is not initialized.')
			: this.available();
	}

	public canSetup() {
		if (this.invalidState) {
			return this.unavailable(Repository.describeInvalidState(this.invalidState));
		}
		if (!this.platformRepositoryRef) {
			return this.unavailable('Repository does not have a platform repository ref.');
		}
		if (this.isInitialized) {
			return this.unavailable('Repository control state is already initialized.');
		}
		return this.available();
	}

	public canRemove(): boolean {
		return true;
	}

	public async setup(
		input: RepositorySetupType,
		context?: EntityExecutionContext
	): Promise<RepositorySetupResultType> {
		const args = RepositorySetupSchema.parse(input);
		this.assertRepositoryIdentity(args);
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			throw new Error(`Repository '${this.id}' does not have a platform repository ref configured.`);
		}
		if (this.invalidState) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		if (this.isInitialized || Repository.readSettingsDocument(this.repositoryRootPath)) {
			throw new Error(`Repository '${this.id}' already has Repository setup state.`);
		}

		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const baseBranch = store.getDefaultBranch();
		const branchRef = store.deriveRepositoryBootstrapBranchName();
		const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-setup-'));
		const proposalWorktreePath = path.join(temporaryRoot, 'setup');
		const platform = this.requireRepositoryPlatformAdapter(context?.authToken);

		try {
			await store.materializeLinkedWorktree(proposalWorktreePath, branchRef, baseBranch);
			const scaffolding = await Repository.initializeScaffolding(proposalWorktreePath, {
				settings: args.settings
			});
			const proposalStore = new MissionDossierFilesystem(proposalWorktreePath);
			proposalStore.stagePaths([
				path.relative(proposalWorktreePath, scaffolding.settingsDocumentPath),
				path.relative(proposalWorktreePath, scaffolding.workflowDirectoryPath)
			], proposalWorktreePath, { force: true });
			proposalStore.commit(Repository.buildRepositorySetupCommitMessage(), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			const pullRequestUrl = await platform.createPullRequest({
				title: 'Initialize Mission repository setup',
				body: Repository.buildRepositorySetupPullRequestBody({ branchRef, baseBranch }),
				headBranch: branchRef,
				baseBranch
			});
			const autoMerge = await Repository.tryAutoMergeSetupPullRequest(platform, pullRequestUrl);
			const basePull = autoMerge.merged
				? Repository.tryPullSetupBaseBranch(platform, baseBranch)
				: { pulled: false };
			refreshSystemStatus({ cwd: proposalWorktreePath });

			return RepositorySetupResultSchema.parse({
				ok: true,
				entity: repositoryEntityName,
				method: 'setup',
				id: this.id,
				kind: 'repository-setup',
				state: autoMerge.merged ? 'merged' : autoMerge.succeeded ? 'auto-merge-requested' : 'pull-request-opened',
				branchRef,
				baseBranch,
				pullRequestUrl,
				settingsPath: scaffolding.settingsDocumentPath,
				workflowDefinitionPath: scaffolding.workflowDefinitionPath,
				autoMergeAttempted: autoMerge.attempted,
				autoMergeSucceeded: autoMerge.succeeded,
				merged: autoMerge.merged,
				basePulled: basePull.pulled,
				...(basePull.error ? { basePullError: basePull.error } : {}),
				...(autoMerge.error ? { autoMergeError: autoMerge.error } : {})
			});
		} finally {
			await store.removeLinkedWorktree(proposalWorktreePath).catch(() => undefined);
			await fsp.rm(temporaryRoot, { recursive: true, force: true });
		}
	}

	public override async remove(
		input: RepositoryLocatorType,
		context?: EntityExecutionContext
	): Promise<RepositoryRemoveAcknowledgementType> {
		const args = RepositoryLocatorSchema.parse(input);
		this.assertRepositoryIdentity(args);
		const repositoryRootPath = await Repository.assertRemovableRepositoryRoot(this.repositoryRootPath);
		await fsp.rm(repositoryRootPath, { recursive: true });
		await this.getEntityFactory(context).remove(Repository, this.id);
		return RepositoryRemoveAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'remove',
			id: this.id
		});
	}

	public async read(input: RepositoryLocatorType): Promise<RepositoryDataType> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		const currentBranch = store.isGitRepository() ? store.getCurrentBranch() : undefined;

		if (settingsState.kind === 'invalid') {
			this.data = RepositoryDataSchema.parse({
				...this.toStorage(),
				operationalMode: 'invalid',
				invalidState: settingsState.invalidState,
				...(currentBranch ? { currentBranch } : {}),
				isInitialized: false
			});
			return this.toData();
		}

		this.data = RepositoryDataSchema.parse({
			...this.toStorage(),
			operationalMode: settingsState.kind === 'valid' ? 'repository' : 'setup',
			...(currentBranch ? { currentBranch } : {}),
			isInitialized: this.isInitialized || settingsState.kind === 'valid'
		});
		return this.toData();
	}

	public async syncStatus(input: RepositoryLocatorType, context?: EntityExecutionContext): Promise<RepositorySyncStatusType> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		return RepositorySyncStatusSchema.parse(this.buildSyncStatus(context?.authToken, { refreshExternalState: true }));
	}

	public async fetchExternalState(
		input: RepositoryLocatorType,
		context?: EntityExecutionContext
	): Promise<RepositorySyncCommandAcknowledgementType> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		this.requireRepositoryPlatformAdapter(context?.authToken).fetchRemote();
		return RepositorySyncCommandAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'fetchExternalState',
			id: this.id,
			syncStatus: this.buildSyncStatus(context?.authToken)
		});
	}

	public async fastForwardFromExternal(
		input: RepositoryLocatorType,
		context?: EntityExecutionContext
	): Promise<RepositorySyncCommandAcknowledgementType> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		const adapter = this.requireRepositoryPlatformAdapter(context?.authToken);
		adapter.fetchRemote();
		const status = this.buildSyncStatus(context?.authToken);
		if (!status.branchRef) {
			throw new Error('Repository has no current branch to fast-forward.');
		}
		if (!status.worktree.clean) {
			throw new Error('Repository has local changes and cannot be fast-forwarded safely.');
		}
		if (status.external.status !== 'behind') {
			throw new Error(Repository.describeExternalSyncState(status));
		}

		adapter.pullBranch(status.branchRef);
		return RepositorySyncCommandAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'fastForwardFromExternal',
			id: this.id,
			syncStatus: this.buildSyncStatus(context?.authToken)
		});
	}

	public async commands(input: RepositoryLocatorType, context?: EntityExecutionContext): Promise<EntityCommandViewType> {
		await this.read(input);
		const { RepositoryContract } = await import('./RepositoryContract.js');
		return EntityCommandViewSchema.parse({
			id: this.id,
			commands: await this.availableCommands(RepositoryContract, {
				surfacePath: this.repositoryRootPath,
				...(context?.authToken ? { authToken: context.authToken } : {}),
				...(context?.missionRegistry ? { missionRegistry: context.missionRegistry } : {}),
				...(context?.missionService ? { missionService: context.missionService } : {}),
				...(context?.entityFactory ? { entityFactory: context.entityFactory } : {})
			})
		});
	}

	public async listIssues(
		input: RepositoryLocatorType,
		context?: { authToken?: string }
	): Promise<TrackedIssueSummaryType[]> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
		return TrackedIssueSummarySchema.array().parse(platform ? await platform.listOpenIssues(25) : []);
	}

	public async getIssue(
		input: RepositoryGetIssueType,
		context?: { authToken?: string }
	): Promise<RepositoryIssueDetailType> {
		const args = RepositoryGetIssueSchema.parse(input);
		this.assertRepositoryIdentity(args);
		return RepositoryIssueDetailSchema.parse(
			await this.requireRepositoryPlatformAdapter(context?.authToken)
				.fetchIssueDetail(String(args.issueNumber))
		);
	}

	public async startMissionFromIssue(
		input: RepositoryStartMissionFromIssueType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		const args = RepositoryStartMissionFromIssueSchema.parse(input);
		this.assertRepositoryIdentity(args);
		await this.refreshRepositoryControlState(args);
		this.assertCanStartRegularMission();
		const brief = await this.requireRepositoryPlatformAdapter(context?.authToken)
			.fetchIssue(String(args.issueNumber));
		return this.prepareMission(brief, 'startMissionFromIssue');
	}

	public async startMissionFromBrief(
		input: RepositoryStartMissionFromBriefType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		const args = RepositoryStartMissionFromBriefSchema.parse(input);
		this.assertRepositoryIdentity(args);
		await this.refreshRepositoryControlState(args);
		this.assertCanStartRegularMission();
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
		const brief = platform
			? await platform.createIssue({
				title: args.title,
				body: args.body
			}).then((createdIssue) => ({
				...args,
				...(createdIssue.issueId !== undefined ? { issueId: createdIssue.issueId } : {}),
				...(createdIssue.url ? { url: createdIssue.url } : {}),
				...(createdIssue.labels ? { labels: createdIssue.labels } : {})
			}))
			: args;

		return this.prepareMission(brief, 'startMissionFromBrief');
	}

	private assertCanStartRegularMission(): void {
		if (this.invalidState) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		if (!this.isInitialized) {
			throw new Error('Complete Repository setup before starting regular missions.');
		}
	}

	private static describeInvalidState(invalidState: RepositoryInvalidStateType): string {
		return `Repository control state is invalid at '${invalidState.path}': ${invalidState.message}`;
	}

	private async refreshRepositoryControlState(input: RepositoryLocatorType): Promise<void> {
		await this.read({
			id: input.id,
			...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
		});
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
		const workflow = parsePersistedWorkflowSettings(workflowDocument);
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const preparation = await this.prepareMissionFromBrief(store, {
			workflow,
			agentRegistry: new AgentRegistry({ agents: [] }),
			...(settings.instructionsPath
				? { instructionsPath: Repository.resolveRepositoryPath(this.repositoryRootPath, settings.instructionsPath) }
				: {}),
			...(settings.skillsPath
				? { skillsPath: Repository.resolveRepositoryPath(this.repositoryRootPath, settings.skillsPath) }
				: {}),
			...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
			...(settings.defaultReasoningEffort ? { defaultReasoningEffort: settings.defaultReasoningEffort } : {}),
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
		store: MissionDossierFilesystem,
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
		const missionWorktreePath = store.getMissionWorktreePath(missionId);
		let preparedMission: Mission | undefined;

		try {
			await this.ensureMissionWorktreeOnBranch(store, missionWorktreePath, branchRef, baseBranch);

			const missionWorktreeStore = new FilesystemAdapter(missionWorktreePath);
			const missionRootDir = missionWorktreeStore.getTrackedMissionDir(missionId, missionWorktreePath);
			const existingDescriptor = await missionWorktreeStore.readMissionDescriptor(missionRootDir);
			if (existingDescriptor) {
				await this.assertExistingMissionRuntimeDataValid(missionWorktreeStore, missionRootDir, missionId);
				return {
					kind: 'mission',
					state: 'branch-prepared',
					missionId,
					branchRef: existingDescriptor.branchRef,
					baseBranch,
					worktreePath: missionWorktreePath,
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
			const preparedWorkflowBindings = await this.resolveMissionWorkflowBindings(workflowBindings, missionWorktreePath);
			preparedMission = new Mission(
				missionWorktreeStore,
				missionRootDir,
				descriptor,
				preparedWorkflowBindings
			);
			await preparedMission.initialize();
			preparedMission.dispose();
			preparedMission = undefined;

			missionWorktreeStore.stagePaths(
				[
					path.relative(missionWorktreePath, Repository.getSettingsDocumentPath(missionWorktreePath, {
						resolveWorkspaceRoot: false
					})),
					path.relative(missionWorktreePath, path.dirname(Repository.getMissionWorkflowDefinitionPath(missionWorktreePath))),
					path.relative(missionWorktreePath, missionRootDir)
				],
				missionWorktreePath,
				{ force: true }
			);
			missionWorktreeStore.commit(Repository.buildMissionPreparationCommitMessage(missionId, input.brief), missionWorktreePath);
			missionWorktreeStore.pushBranch(branchRef, missionWorktreePath);

			return {
				kind: 'mission',
				state: 'branch-prepared',
				missionId,
				branchRef,
				baseBranch,
				worktreePath: missionWorktreePath,
				missionRootDir: canonicalMissionRootDir,
				...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
				...(input.brief.url ? { issueUrl: input.brief.url } : {})
			};
		} finally {
			preparedMission?.dispose();
		}
	}

	private async ensureMissionWorktreeOnBranch(
		store: FilesystemAdapter,
		missionWorktreePath: string,
		branchRef: string,
		baseBranch: string
	): Promise<void> {
		if (!fs.existsSync(missionWorktreePath)) {
			await store.materializeMissionWorktree(missionWorktreePath, branchRef, baseBranch);
			return;
		}

		const missionWorktreeStore = new FilesystemAdapter(missionWorktreePath);
		if (!missionWorktreeStore.isGitRepository()) {
			throw new Error(`Mission worktree root '${missionWorktreePath}' already exists but is not a Git worktree.`);
		}

		const currentBranch = missionWorktreeStore.getCurrentBranch(missionWorktreePath);
		if (currentBranch !== branchRef) {
			throw new Error(
				`Mission worktree root '${missionWorktreePath}' already exists on branch '${currentBranch}' instead of expected Mission branch '${branchRef}'.`
			);
		}
	}

	private async assertExistingMissionRuntimeDataValid(
		adapter: MissionDossierFilesystem,
		missionDir: string,
		missionId: string
	): Promise<void> {
		const { Mission } = await import('../Mission/Mission.js');
		try {
			const existingData = await Mission.readStateData(adapter, missionDir);
			if (!existingData) {
				throw new Error(`Mission runtime data is missing for existing Mission '${missionId}'.`);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Mission '${missionId}' already exists at '${missionDir}', but its Mission runtime data is invalid for the current runtime schema. Delete or explicitly recreate the Mission; Mission does not fallback-load or implicitly migrate stale runtime data. ${detail}`
			);
		}
	}

	private async resolveMissionWorkflowBindings(
		workflowBindings: MissionWorkflowBindings,
		repositoryRootPath: string
	): Promise<MissionWorkflowBindings> {
		if (workflowBindings.agentRegistry.listAgents().length > 0) {
			return workflowBindings;
		}
		const { AgentRegistry } = await import('../Agent/AgentRegistry.js');
		return {
			...workflowBindings,
			agentRegistry: await AgentRegistry.createConfigured({ repositoryRootPath })
		};
	}

	private tryCreateRepositoryPlatformAdapter(authToken?: string) {
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			return undefined;
		}

		const ghBinary = getMissionGitHubCliBinary();
		return createRepositoryPlatformAdapter({
			platform: 'github',
			repositoryRootPath: this.repositoryRootPath,
			repository: platformRepositoryRef,
			...(authToken ? { authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});
	}

	private requireRepositoryPlatformAdapter(authToken?: string) {
		const adapter = this.tryCreateRepositoryPlatformAdapter(authToken);
		if (!adapter) {
			throw new Error(`Repository '${this.id}' does not have a platform repository ref configured.`);
		}
		return adapter;
	}

	private static async tryAutoMergeSetupPullRequest(
		platform: RepositoryPlatformAdapter,
		pullRequestUrl: string
	): Promise<{ attempted: boolean; succeeded: boolean; merged: boolean; error?: string }> {
		try {
			await platform.mergePullRequest({
				pullRequest: pullRequestUrl,
				method: 'squash'
			});
			return { attempted: true, succeeded: true, merged: true };
		} catch (mergeError) {
			const immediateMergeError = mergeError instanceof Error ? mergeError.message : String(mergeError);
			try {
				await platform.mergePullRequest({
					pullRequest: pullRequestUrl,
					method: 'squash',
					auto: true
				});
				return { attempted: true, succeeded: true, merged: false };
			} catch (autoMergeError) {
				const autoMergeMessage = autoMergeError instanceof Error ? autoMergeError.message : String(autoMergeError);
				return {
					attempted: true,
					succeeded: false,
					merged: false,
					error: `${immediateMergeError}\n${autoMergeMessage}`
				};
			}
		}
	}

	private static tryPullSetupBaseBranch(
		platform: RepositoryPlatformAdapter,
		baseBranch: string
	): { pulled: boolean; error?: string } {
		try {
			platform.fetchRemote();
			platform.pullBranch(baseBranch);
			return { pulled: true };
		} catch (error) {
			return {
				pulled: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	private buildSyncStatus(
		authToken?: string,
		options: { refreshExternalState?: boolean } = {}
	): RepositorySyncStatusType {
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const rootExists = fs.existsSync(this.repositoryRootPath);
		const isGitRepository = rootExists && store.isGitRepository();
		const worktree = isGitRepository
			? store.getWorktreeStatus()
			: {
				clean: false,
				stagedCount: 0,
				unstagedCount: 0,
				untrackedCount: 0
			};
		const branchRef = isGitRepository ? store.getCurrentBranch() : undefined;
		const defaultBranch = isGitRepository ? store.getDefaultBranch() : undefined;
		const platformRepositoryRef = this.platformRepositoryRef?.trim() || undefined;
		const platform = platformRepositoryRef ? 'github' as const : undefined;

		let external: RepositorySyncStatusType['external'] = {
			status: 'unavailable',
			aheadCount: 0,
			behindCount: 0,
			unavailableReason: !rootExists
				? 'Repository root does not exist.'
				: platformRepositoryRef
					? 'Repository external branch status is unavailable.'
					: 'Repository has no external platform repository ref.'
		};

		if (isGitRepository && branchRef && branchRef !== 'HEAD') {
			const adapter = this.tryCreateRepositoryPlatformAdapter(authToken);
			if (adapter) {
				try {
					if (options.refreshExternalState) {
						adapter.fetchRemote();
					}
					const branchStatus = adapter.getBranchSyncStatus(branchRef);
					external = {
						status: branchStatus.status,
						aheadCount: branchStatus.aheadCount,
						behindCount: branchStatus.behindCount,
						...(branchStatus.trackingRef ? { trackingRef: branchStatus.trackingRef } : {}),
						...(branchStatus.localHead ? { localHead: branchStatus.localHead } : {}),
						...(branchStatus.remoteHead ? { remoteHead: branchStatus.remoteHead } : {})
					};
				} catch (error) {
					external = {
						status: 'unavailable',
						aheadCount: 0,
						behindCount: 0,
						unavailableReason: error instanceof Error ? error.message : String(error)
					};
				}
			}
		}

		return RepositorySyncStatusSchema.parse({
			id: this.id,
			repositoryRootPath: this.repositoryRootPath,
			checkedAt: new Date().toISOString(),
			...(platform ? { platform } : {}),
			...(platformRepositoryRef ? { platformRepositoryRef } : {}),
			...(platformRepositoryRef ? { remoteName: 'origin' } : {}),
			...(branchRef ? { branchRef } : {}),
			...(defaultBranch ? { defaultBranch } : {}),
			worktree,
			external
		});
	}

	private static describeExternalSyncState(status: RepositorySyncStatusType): string {
		switch (status.external.status) {
			case 'up-to-date':
				return 'Repository is already up to date with its external tracking branch.';
			case 'ahead':
				return 'Repository has local commits that are not on its external tracking branch.';
			case 'diverged':
				return 'Repository has diverged from its external tracking branch.';
			case 'untracked':
				return 'Repository branch has no external tracking branch.';
			case 'unavailable':
				return status.external.unavailableReason ?? 'Repository external branch status is unavailable.';
			case 'behind':
				return 'Repository can be fast-forwarded from its external tracking branch.';
		}
	}

	private assertRepositoryIdentity(input: { id: string; repositoryRootPath?: string | undefined }): void {
		if (input.id !== this.id) {
			throw new Error(`Repository arguments id '${input.id}' does not match '${this.id}'.`);
		}

		if (input.repositoryRootPath && path.resolve(input.repositoryRootPath) !== this.repositoryRootPath) {
			throw new Error(`Repository arguments root '${input.repositoryRootPath}' does not match '${this.repositoryRootPath}'.`);
		}
	}

	private static createRepositoryData(input: RepositoryInputType): RepositoryStorageType {
		const normalizedRepositoryRootPath = path.resolve(input.repositoryRootPath);
		const identity = Repository.deriveIdentity(normalizedRepositoryRootPath);
		const explicitPlatformRepositoryRef = input.platformRepositoryRef?.trim();
		const platformRepositoryRef = explicitPlatformRepositoryRef || identity.platformRepositoryRef;
		const { ownerId, repoName } = Repository.deriveRepositoryNames(normalizedRepositoryRootPath, platformRepositoryRef);
		const defaults = createDefaultRepositoryConfiguration();

		return RepositoryStorageSchema.parse({
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

	private static buildMissionPreparationCommitMessage(missionId: string, brief: MissionBrief): string {
		return `chore(mission): prepare ${missionId}${brief.issueId !== undefined ? ` for #${String(brief.issueId)}` : ''}`;
	}

	private static buildRepositorySetupCommitMessage(): string {
		return 'chore(mission): initialize repository setup';
	}

	private static buildRepositorySetupPullRequestBody(input: { branchRef: string; baseBranch: string }): string {
		return [
			'## Repository Setup',
			'',
			'This PR initializes tracked Mission repository setup.',
			'',
			`- Branch: \`${input.branchRef}\``,
			`- Base: \`${input.baseBranch}\``,
			'- Creates `.mission/settings.json` for Repository control settings.',
			'- Creates `.mission/workflow/workflow.json` and the default workflow template preset.',
			'- Leaves Mission dossiers to future Mission branches.',
			'',
			'After this PR merges, update the local default branch before starting missions.'
		].join('\n');
	}

	private static getRepositoryFactory(context?: EntityExecutionContext) {
		const factory = Repository.getEntityFactory(context);
		if (!factory.has(Repository)) {
			factory.register({
				entityName: repositoryEntityName,
				table: 'repository',
				entityClass: Repository,
				storageSchema: RepositoryStorageSchema,
				getId: (record) => record.id
			});
		}
		return factory;
	}
}

export type {
	RepositoryStorageType,
	RepositoryInputType
};