import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityClassCommandViewType, type EntityCommandViewType } from '../Entity/EntitySchema.js';
import { AgentRegistry } from '../Agent/AgentRegistry.js';
import { getDefaultAgentExecutionRegistry } from '../../daemon/runtime/agent/AgentExecutionRegistry.js';
import type { AgentExecutionDataType } from '../AgentExecution/AgentExecutionSchema.js';
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
	type RepositoryEnsureSystemAgentExecutionType,
	type RepositoryClassCommandsType,
	type RepositoryGetIssueType,
	type RepositoryLocatorType,
	type RepositoryAddType,
	type RepositoryRemoveAcknowledgementType,
	type RepositoryInitializeResultType,
	type RepositoryInitializeType,
	type RepositorySetupResultType,
	type RepositorySetupType,
	type RepositoryConfigureAgentsType,
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
	RepositoryEnsureSystemAgentExecutionSchema,
	RepositoryClassCommandsSchema,
	RepositoryGetIssueSchema,
	RepositoryLocatorSchema,
	RepositoryMissionStartAcknowledgementSchema,
	RepositoryAddSchema,
	RepositoryRemoveAcknowledgementSchema,
	RepositoryInitializeResultSchema,
	RepositoryInitializeSchema,
	RepositoryConfigureAgentsSchema,
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

type RepositorySettingsDocumentReadOptions = {
	resolveWorkspaceRoot?: boolean;
	invalidDocument?: 'throw' | 'missing';
};

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

	public static async ensureSystemAgentExecution(
		input: RepositoryEnsureSystemAgentExecutionType = {},
		context?: EntityExecutionContext
	): Promise<AgentExecutionDataType> {
		RepositoryEnsureSystemAgentExecutionSchema.parse(input);
		const repositoriesRootPath = resolveRepositoriesRoot(readMissionConfig());
		const settings = createDefaultRepositorySettings();
		const agentRegistry = await AgentRegistry.createConfigured({
			repositoryRootPath: repositoriesRootPath,
			settings
		});
		const agentId = agentRegistry.resolveStartAgentId(settings.agentAdapter);
		if (!agentId) {
			throw new Error('No repository manager agent is available for the repositories surface.');
		}
		const agentExecutionRegistry = context?.agentExecutionRegistry ?? getDefaultAgentExecutionRegistry();
		return await agentExecutionRegistry.ensureExecution({
			ownerKey: Repository.createSystemAgentExecutionOwnerKey(repositoriesRootPath),
			agentRegistry,
			config: {
				scope: {
					kind: 'system',
					label: '/repositories'
				},
				workingDirectory: repositoriesRootPath,
				specification: {
					summary: 'Manage the repositories surface for Airport.',
					documents: []
				},
				requestedAdapterId: agentId,
				resume: { mode: 'new' },
				initialPrompt: {
					source: 'system',
					text: await Repository.buildSystemAgentPrompt(context, repositoriesRootPath)
				}
			}
		});
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
		const status = this.buildSyncStatus(context?.authToken);
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
		await repository.initialize({
			id: repository.id,
			repositoryRootPath: repository.repositoryRootPath
		}, context);
		await Repository.getRepositoryFactory(context).save(Repository, repository.toStorage());
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

	public static hasWorkflowDefinition(repositoryRootPath: string): boolean {
		return fs.existsSync(Repository.getMissionWorkflowDefinitionPath(repositoryRootPath));
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
		options: RepositorySettingsDocumentReadOptions = {}
	): RepositorySettingsType | undefined {
		const documentState = Repository.inspectSettingsDocument(repositoryRootPath, options);
		if (documentState.kind === 'missing') {
			return undefined;
		}
		if (documentState.kind === 'invalid') {
			if (options.invalidDocument === 'missing') {
				return undefined;
			}
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

	private static async createPreparedRepositorySettings(repositoryRootPath: string): Promise<RepositorySettingsType> {
		const defaultSettings = createDefaultRepositorySettings();
		const registry = await AgentRegistry.createConfigured({ repositoryRootPath });
		const availableAgentIds = registry.listAgents()
			.filter((agent) => agent.toData().availability.available)
			.map((agent) => agent.agentId);

		if (availableAgentIds.length === 0) {
			return defaultSettings;
		}

		const enabledAdapters = [...availableAgentIds];
		const defaultAgentAdapter = availableAgentIds.includes(defaultSettings.agentAdapter)
			? defaultSettings.agentAdapter
			: enabledAdapters[0] ?? defaultSettings.agentAdapter;

		return RepositorySettingsSchema.parse({
			...defaultSettings,
			agentAdapter: defaultAgentAdapter,
			enabledAgentAdapters: enabledAdapters
		});
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
		if (this.invalidState && !this.isRecoverableSetupState()) {
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

	public canInitialize() {
		if (this.invalidState && !this.isRecoverableSetupState()) {
			return this.unavailable(Repository.describeInvalidState(this.invalidState));
		}
		return this.available();
	}

	public async initialize(
		input: RepositoryInitializeType,
		_context?: EntityExecutionContext
	): Promise<RepositoryInitializeResultType> {
		const args = RepositoryInitializeSchema.parse(input);
		this.assertRepositoryIdentity(args);
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (settingsState.kind === 'invalid') {
			return RepositoryInitializeResultSchema.parse({
				ok: true,
				entity: repositoryEntityName,
				method: 'initialize',
				id: this.id,
				state: 'skipped-invalid-settings',
				settingsPath: settingsState.settingsPath,
				enabledAgentAdapters: []
			});
		}

		if (settingsState.kind === 'valid') {
			this.updateSettings(settingsState.settings);
			return RepositoryInitializeResultSchema.parse({
				ok: true,
				entity: repositoryEntityName,
				method: 'initialize',
				id: this.id,
				state: 'already-initialized',
				settingsPath: settingsState.settingsPath,
				defaultAgentAdapter: settingsState.settings.agentAdapter,
				enabledAgentAdapters: settingsState.settings.enabledAgentAdapters
			});
		}

		const settings = await Repository.createPreparedRepositorySettings(this.repositoryRootPath);
		await Repository.writeSettingsDocument(settings, this.repositoryRootPath, { resolveWorkspaceRoot: false });
		this.updateSettings(settings).markInitialized(false);
		return RepositoryInitializeResultSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'initialize',
			id: this.id,
			state: 'initialized',
			settingsPath: Repository.getSettingsDocumentPath(this.repositoryRootPath, { resolveWorkspaceRoot: false }),
			defaultAgentAdapter: settings.agentAdapter,
			enabledAgentAdapters: settings.enabledAgentAdapters
		});
	}

	public async configureAgents(
		input: RepositoryConfigureAgentsType,
		context?: EntityExecutionContext
	): Promise<RepositoryDataType> {
		const args = RepositoryConfigureAgentsSchema.parse(input);
		this.assertRepositoryIdentity(args);

		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (settingsState.kind === 'invalid') {
			throw new Error(Repository.describeInvalidState(settingsState.invalidState));
		}

		const currentSettings = settingsState.kind === 'valid'
			? settingsState.settings
			: await Repository.createPreparedRepositorySettings(this.repositoryRootPath);
		const agentRegistry = await AgentRegistry.createConfigured({
			repositoryRootPath: this.repositoryRootPath,
			settings: currentSettings
		});
		const availableAgentIds = agentRegistry.listAgents()
			.filter((agent) => agent.toData().availability.available)
			.map((agent) => agent.agentId);
		if (availableAgentIds.length === 0) {
			throw new Error(`Repository '${this.id}' does not have any available agents to configure.`);
		}

		const requestedEnabledAgentIds = [...new Set(args.enabledAgentAdapters.map((agentId) => agentId.trim()).filter(Boolean))];
		const invalidAgentId = requestedEnabledAgentIds.find((agentId) => !availableAgentIds.includes(agentId));
		if (invalidAgentId) {
			throw new Error(`Repository '${this.id}' cannot enable unavailable agent '${invalidAgentId}'.`);
		}
		if (requestedEnabledAgentIds.length === 0) {
			throw new Error(`Repository '${this.id}' must enable at least one available agent.`);
		}
		if (!requestedEnabledAgentIds.includes(args.defaultAgentAdapter)) {
			throw new Error(`Repository '${this.id}' must select a default agent from the enabled agents.`);
		}

		const nextSettings = RepositorySettingsSchema.parse({
			...currentSettings,
			agentAdapter: args.defaultAgentAdapter,
			enabledAgentAdapters: requestedEnabledAgentIds
		});
		await Repository.writeSettingsDocument(nextSettings, this.repositoryRootPath, { resolveWorkspaceRoot: false });
		this.updateSettings(nextSettings);
		await Repository.getRepositoryFactory(context).save(Repository, this.toStorage());
		if (currentSettings.agentAdapter !== nextSettings.agentAdapter) {
			await this.replaceActiveRepositoryAgentExecution(nextSettings, context);
		}
		return await this.read({
			id: this.id,
			repositoryRootPath: this.repositoryRootPath
		});
	}

	public async ensureRepositoryAgentExecution(
		input: RepositoryInitializeType,
		context?: EntityExecutionContext
	): Promise<AgentExecutionDataType> {
		const args = RepositoryInitializeSchema.parse(input);
		this.assertRepositoryIdentity(args);
		this.assertCanLaunchRepositoryAgentExecution();
		await this.ensurePreparedForRepositoryAgentExecution(context);

		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		const setupSettings = settingsState.kind === 'valid'
			? settingsState.settings
			: createDefaultRepositorySettings();
		const agentRegistry = await AgentRegistry.createConfigured({
			repositoryRootPath: this.repositoryRootPath,
			settings: setupSettings
		});
		const enabledAgentIds = setupSettings.enabledAgentAdapters.length > 0
			? setupSettings.enabledAgentAdapters
			: agentRegistry.listAgents()
				.filter((agent) => agent.toData().availability.available)
				.map((agent) => agent.agentId);
		const agentId = enabledAgentIds.includes(setupSettings.agentAdapter)
			? agentRegistry.resolveStartAgentId(setupSettings.agentAdapter)
			: enabledAgentIds[0];
		if (!agentId) {
			throw new Error(`Repository '${this.id}' does not have an available repository agent.`);
		}
		const agentExecutionRegistry = context?.agentExecutionRegistry ?? getDefaultAgentExecutionRegistry();
		const initialPromptText = await this.buildRepositoryAgentPrompt(context);
		return agentExecutionRegistry.ensureExecution({
			ownerKey: Repository.createRepositoryAgentExecutionOwnerKey(this.repositoryRootPath),
			agentRegistry,
			config: {
				scope: {
					kind: 'repository',
					repositoryRootPath: this.repositoryRootPath
				},
				workingDirectory: this.repositoryRootPath,
				specification: {
					summary: `Manage repository ${this.platformRepositoryRef ?? this.repoName}.`,
					documents: []
				},
				requestedAdapterId: agentId,
				resume: { mode: 'new' },
				initialPrompt: {
					source: 'system',
					text: initialPromptText
				}
			}
		});
	}

	private async replaceActiveRepositoryAgentExecution(
		settings: RepositorySettingsType,
		context?: EntityExecutionContext
	): Promise<void> {
		const agentRegistry = await AgentRegistry.createConfigured({
			repositoryRootPath: this.repositoryRootPath,
			settings
		});
		const enabledAgentIds = settings.enabledAgentAdapters.length > 0
			? settings.enabledAgentAdapters
			: agentRegistry.listAgents()
				.filter((agent) => agent.toData().availability.available)
				.map((agent) => agent.agentId);
		const agentId = enabledAgentIds.includes(settings.agentAdapter)
			? agentRegistry.resolveStartAgentId(settings.agentAdapter)
			: enabledAgentIds[0];
		if (!agentId) {
			return;
		}

		const agentExecutionRegistry = context?.agentExecutionRegistry ?? getDefaultAgentExecutionRegistry();
		const initialPromptText = await this.buildRepositoryAgentPrompt(context);
		await agentExecutionRegistry.replaceActiveExecution({
			ownerKey: Repository.createRepositoryAgentExecutionOwnerKey(this.repositoryRootPath),
			agentRegistry,
			config: {
				scope: {
					kind: 'repository',
					repositoryRootPath: this.repositoryRootPath
				},
				workingDirectory: this.repositoryRootPath,
				specification: {
					summary: `Manage repository ${this.platformRepositoryRef ?? this.repoName}.`,
					documents: []
				},
				requestedAdapterId: agentId,
				resume: { mode: 'new' },
				initialPrompt: {
					source: 'system',
					text: initialPromptText
				}
			}
		});
	}

	private static async buildSystemAgentPrompt(
		context: EntityExecutionContext | undefined,
		repositoriesRootPath: string
	): Promise<string> {
		const repositories = await Repository.find({}, context);
		const localRepositoryLines = repositories.length > 0
			? repositories
				.map((repository) => `- ${repository.platformRepositoryRef ?? repository.repoName} (${repository.repositoryRootPath})`)
				.join('\n')
			: '- none';
		let externalSummary = 'External repositories: unavailable.';
		try {
			const available = await Repository.findAvailable({ platform: 'github' }, context);
			externalSummary = available.length > 0
				? `External repositories visible: ${available.length}.`
				: 'External repositories visible: none.';
		} catch {
			// Keep the repositories manager prompt resilient when GitHub discovery is unavailable.
		}

		return [
			'You are the system-scoped repositories manager for Airport.',
			`Repositories root: ${repositoriesRootPath}.`,
			'Checked out repositories:',
			localRepositoryLines,
			externalSummary,
			'First priority: summarize the current repository landscape, highlight missing local checkouts or repositories needing attention, and propose the next best repository-level action.'
		].join('\n');
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
		if (this.invalidState && !this.isRecoverableSetupState()) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (this.isInitialized || (settingsState.kind === 'valid' && Repository.hasWorkflowDefinition(this.repositoryRootPath))) {
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
				operationalMode: 'setup',
				...(currentBranch ? { currentBranch } : {}),
				isInitialized: false
			});
			return this.toData();
		}

		const hasRepositorySetupState = settingsState.kind === 'valid'
			&& Repository.hasWorkflowDefinition(this.repositoryRootPath);
		this.data = RepositoryDataSchema.parse({
			...this.toStorage(),
			...(settingsState.kind === 'valid' ? { settings: settingsState.settings } : {}),
			operationalMode: this.isInitialized || hasRepositorySetupState ? 'repository' : 'setup',
			...(currentBranch ? { currentBranch } : {}),
			isInitialized: this.isInitialized || hasRepositorySetupState
		});
		return this.toData();
	}

	public async syncStatus(input: RepositoryLocatorType, context?: EntityExecutionContext): Promise<RepositorySyncStatusType> {
		this.assertRepositoryIdentity(RepositoryLocatorSchema.parse(input));
		return RepositorySyncStatusSchema.parse(this.buildSyncStatus(context?.authToken));
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

	private isRecoverableSetupState(): boolean {
		return this.invalidState?.code === 'invalid-settings-document';
	}

	private assertCanLaunchRepositoryAgentExecution(): void {
		if (this.invalidState && !this.isRecoverableSetupState()) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
	}

	private async ensurePreparedForRepositoryAgentExecution(context?: EntityExecutionContext): Promise<void> {
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (settingsState.kind !== 'valid') {
			await this.initialize({ id: this.id, repositoryRootPath: this.repositoryRootPath }, context);
		}
	}

	private async buildRepositoryAgentPrompt(context?: EntityExecutionContext): Promise<string> {
		const syncStatus = this.buildSyncStatus(context?.authToken);
		const missionStore = new MissionDossierFilesystem(this.repositoryRootPath);
		const missions = await missionStore.listMissions().catch(() => []);
		const issues = await this.listIssues({
			id: this.id,
			repositoryRootPath: this.repositoryRootPath
		}, {
			...(context?.authToken ? { authToken: context.authToken } : {})
		}).catch(() => []);
		const missionIssueIds = new Set(
			missions
				.map(({ descriptor }) => descriptor.brief.issueId)
				.filter((issueId): issueId is number => issueId !== undefined)
		);
		const branchSummary = syncStatus.branchRef
			? `Current branch: ${syncStatus.branchRef}.`
			: 'Current branch is unavailable.';
		const worktreeSummary = `Worktree status: ${syncStatus.worktree.clean ? 'clean' : 'dirty'} (${syncStatus.worktree.stagedCount} staged, ${syncStatus.worktree.unstagedCount} unstaged, ${syncStatus.worktree.untrackedCount} untracked).`;
		const externalSummary = [
			syncStatus.external.status !== 'unavailable'
				? `Remote status: ${syncStatus.external.status}.`
				: syncStatus.external.unavailableReason
					? `Remote status unavailable: ${syncStatus.external.unavailableReason}.`
					: 'Remote status is unavailable.',
			syncStatus.external.aheadCount > 0 ? `Ahead by ${syncStatus.external.aheadCount} commit(s).` : undefined,
			syncStatus.external.behindCount > 0 ? `Behind by ${syncStatus.external.behindCount} commit(s).` : undefined
		].filter((part): part is string => Boolean(part));
		const missionLines = missions.length === 0
			? ['Tracked missions: none.']
			: [
				`Tracked missions (${missions.length}):`,
				...missions.slice(0, 5).map(({ descriptor }) => {
					const issueSegment = descriptor.brief.issueId !== undefined ? ` issue #${descriptor.brief.issueId}` : '';
					return `- ${descriptor.missionId}: ${descriptor.brief.title} (${descriptor.branchRef}${issueSegment})`;
				}),
				...(missions.length > 5 ? [`- ${missions.length - 5} more mission(s) not listed.`] : [])
			];
		const issueLines = issues.length === 0
			? [
				this.platformRepositoryRef
					? 'Open GitHub issues: none visible.'
					: 'Open GitHub issues: unavailable because no platform repository ref is configured.'
			]
			: [
				`Open GitHub issues (${issues.length}):`,
				...issues.slice(0, 5).map((issue) => {
					const trackedByMission = missionIssueIds.has(issue.number)
						? 'already tracked by a Mission'
						: 'no Mission yet';
					const labels = issue.labels.length > 0 ? ` labels: ${issue.labels.join(', ')}` : '';
					const updatedAt = issue.updatedAt ? ` updated: ${issue.updatedAt}` : '';
					return `- #${issue.number} ${issue.title} (${trackedByMission};${updatedAt}${labels})`;
				}),
				...(issues.length > 5 ? [`- ${issues.length - 5} more open issue(s) not listed.`] : [])
			];
		const initializationSummary = this.invalidState
			? `Repository control state is invalid at '${this.invalidState.path}': ${this.invalidState.message}`
			: this.isInitialized
				? 'Repository control state is initialized.'
				: 'Repository control state is not fully initialized yet.';
		const untrackedIssues = issues.filter((issue) => !missionIssueIds.has(issue.number));
		const firstUntrackedIssue = untrackedIssues[0];
		const firstPriority = this.invalidState || !this.isInitialized
			? 'First priority: recover or complete Repository initialization before proposing regular mission work.'
			: syncStatus.external.status === 'behind'
				? 'First priority: review remote drift and decide whether to fetch or fast-forward before other repository work.'
				: syncStatus.worktree.clean === false
					? 'First priority: account for the dirty worktree before starting or changing repository work.'
					: firstUntrackedIssue
						? `First priority: review untracked open issues, starting with issue #${firstUntrackedIssue.number}.`
						: missions.length > 0
							? 'First priority: review active Mission coverage and identify the most useful repository-level follow-up.'
							: 'First priority: identify the next repository-management action from the current status and issue context.';
		return [
			`Help manage ${this.platformRepositoryRef ?? this.repoName} for Mission.`,
			'Repository initialization is part of repository management when repository control state is missing or invalid.',
			initializationSummary,
			branchSummary,
			worktreeSummary,
			...externalSummary,
			...missionLines,
			...issueLines,
			firstPriority,
			'Report progress, input requests, blockers, and completion claims through the AgentExecution structured interaction protocol.',
			'In the first response, briefly summarize the repository situation and propose or begin the highest-priority action instead of asking generic opening questions.',
			'Keep the conversation concise and focused on repository management tasks.'
		].join('\n');
	}

	private static createRepositoryAgentExecutionOwnerKey(repositoryRootPath: string): string {
		return `Repository.agentExecution:${repositoryRootPath}`;
	}

	private static createSystemAgentExecutionOwnerKey(repositoriesRootPath: string): string {
		return `Repository.systemAgentExecution:${repositoriesRootPath}`;
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

			const missionWorktreeStore = new MissionDossierFilesystem(missionWorktreePath);
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
		store: MissionDossierFilesystem,
		missionWorktreePath: string,
		branchRef: string,
		baseBranch: string
	): Promise<void> {
		if (!fs.existsSync(missionWorktreePath)) {
			await store.materializeMissionWorktree(missionWorktreePath, branchRef, baseBranch);
			return;
		}

		const missionWorktreeStore = new MissionDossierFilesystem(missionWorktreePath);
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