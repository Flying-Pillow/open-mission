import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEntityIdentitySegment, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityClassCommandViewType, type EntityCommandViewType } from '../Entity/EntitySchema.js';
import { AgentRegistry } from '../Agent/AgentRegistry.js';
import type { AgentExecutionType } from '../AgentExecution/AgentExecutionSchema.js';
import { Mission } from '../Mission/Mission.js';
import {
	getDefaultOpenMissionConfig,
	getOpenMissionGitHubCliBinary,
	readOpenMissionConfig,
	resolveRepositoriesRoot
} from '../../settings/OpenMissionInstall.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { resolveGitHubRepositoryFromRepositoryRoot } from '../../platforms/GitHubPlatformAdapter.js';
import { refreshSystemStatus } from '../System/SystemStatus.js';
import type { MissionBrief, MissionDescriptor } from '../Mission/MissionSchema.js';
import { resolveGitWorkspaceRoot } from '../../platforms/git/GitWorkspace.js';
import {
	RepositorySchema,
	RepositoryStorageSchema,
	RepositoryInputSchema,
	repositoryEntityName,
	RepositoryWorkflowConfigurationSchema,
	createDefaultRepositoryConfiguration,
	RepositoryIssueDetailSchema,
	TrackedIssueSummarySchema,
	type RepositoryPlatformOwnerType,
	type RepositoryPlatformRepositoryType,
	type RepositoryType,
	type RepositoryStorageType,
	type RepositoryInputType,
	type RepositoryIssueDetailType,
	type RepositoryMissionStartAcknowledgementType,
	type TrackedIssueSummaryType,
	type RepositoryFindType,
	type RepositoryFindAvailableType,
	type RepositoryFindAvailableOwnersType,
	type RepositoryEnsureSystemAgentExecutionType,
	type RepositoryClassCommandsType,
	type RepositoryGetIssueType,
	type RepositoryInstanceInputType,
	type RepositoryReadRemovalSummaryType,
	type RepositoryReadCodeGraphSnapshotType,
	type RepositoryCodeGraphSnapshotType,
	type RepositoryAddType,
	type RepositoryCreateType,
	type RepositoryRemoveAcknowledgementType,
	type RepositoryInitializeResultType,
	type RepositoryInitializeType,
	type RepositorySetupResultType,
	type RepositorySetupType,
	type RepositoryConfigureAgentType,
	type RepositoryConfigureAgentsType,
	type RepositoryConfigureDisplayType,
	type RepositoryCodeIndexAcknowledgementType,
	type RepositorySyncCommandAcknowledgementType,
	type RepositorySyncStatusType,
	type RepositoryRemovalSummaryType,
	type RepositoryRemovalSummaryMissionType,
	type RepositorySettingsType,
	type RepositoryInvalidStateType,
	type RepositoryStartMissionFromBriefType,
	type RepositoryStartMissionFromIssueType,
	RepositorySettingsSchema,
	createDefaultRepositorySettings,
	RepositoryFindSchema,
	RepositoryFindAvailableSchema,
	RepositoryFindAvailableOwnersSchema,
	RepositoryEnsureSystemAgentExecutionSchema,
	RepositoryClassCommandsSchema,
	RepositoryGetIssueSchema,
	RepositoryInstanceInputSchema,
	RepositoryLocatorSchema,
	RepositoryCodeGraphSnapshotSchema,
	RepositoryReadCodeGraphSnapshotSchema,
	RepositoryReadRemovalSummarySchema,
	RepositoryMissionStartAcknowledgementSchema,
	RepositoryAddSchema,
	RepositoryCreateSchema,
	RepositoryRemoveAcknowledgementSchema,
	RepositoryInitializeResultSchema,
	RepositoryInitializeSchema,
	RepositoryConfigureAgentsSchema,
	RepositoryConfigureAgentSchema,
	RepositoryConfigureDisplaySchema,
	RepositoryCodeIndexAcknowledgementSchema,
	RepositorySetupResultSchema,
	RepositorySetupSchema,
	RepositorySyncCommandAcknowledgementSchema,
	RepositorySyncStatusSchema,
	RepositoryRemovalSummarySchema,
	RepositoryLocalAddInputSchema,
	RepositoryStartMissionFromBriefSchema,
	RepositoryStartMissionFromIssueSchema
} from './RepositorySchema.js';
import type { WorkflowDefinition } from '../../workflow/WorkflowSchema.js';
import { parsePersistedWorkflowSettings } from '../../settings/validation.js';
import {
	WorkflowStateDataSchema,
	type WorkflowStateData,
	isActiveAgentExecutionLifecycle
} from '../../workflow/engine/index.js';
import {
	createRepositoryPlatformAdapter,
	type RepositoryPlatformAdapter,
} from './PlatformAdapter.js';

export type RepositoryIdentity = {
	id: string;
	repositoryRootPath: string;
	platformRepositoryRef?: string;
};

type RepositoryCodeIntelligenceService = {
	ensureIndex(input: { rootPath: string }): Promise<unknown>;
	readActiveIndex?(input: { rootPath: string }): Promise<unknown>;
};

type RepositoryAgentExecutionRegistry = {
	ensureExecution(input: {
		ownerKey: string;
		agentRegistry: AgentRegistry;
		config: Record<string, unknown>;
	}): Promise<AgentExecutionType>;
	replaceActiveExecution?(input: {
		ownerKey: string;
		agentRegistry: AgentRegistry;
		config: Record<string, unknown>;
	}): Promise<AgentExecutionType>;
	readReusableExecution?(input: {
		ownerKey: string;
		requestedAgentId?: string;
	}): AgentExecutionType | undefined;
};

function readContextCapability<T>(
	context: EntityExecutionContext | undefined,
	capability: string
): T | undefined {
	return context?.[capability] as T | undefined;
}

function readAgentExecutionRegistry(context?: EntityExecutionContext): RepositoryAgentExecutionRegistry | undefined {
	const capability = readContextCapability<RepositoryAgentExecutionRegistry>(context, 'agentExecutionRegistry');
	return capability && typeof capability.ensureExecution === 'function'
		? capability
		: undefined;
}

function requireAgentExecutionRegistry(
	context: EntityExecutionContext | undefined,
	operation: string
): RepositoryAgentExecutionRegistry {
	const registry = readAgentExecutionRegistry(context);
	if (!registry) {
		throw new Error(`Repository ${operation} requires an agentExecutionRegistry capability in the Entity execution context.`);
	}
	return registry;
}

function readCodeIntelligenceService(context?: EntityExecutionContext): RepositoryCodeIntelligenceService | undefined {
	const capability = readContextCapability<RepositoryCodeIntelligenceService>(context, 'codeIntelligenceService');
	return capability && typeof capability.ensureIndex === 'function' ? capability : undefined;
}

function requireCodeIntelligenceService(
	context: EntityExecutionContext | undefined,
	operation: string
): RepositoryCodeIntelligenceService {
	const service = readCodeIntelligenceService(context);
	if (!service) {
		throw new Error(`Repository ${operation} requires a codeIntelligenceService capability in the Entity execution context.`);
	}
	return service;
}

function resolveWorkflowCurrentStage(document: WorkflowStateData): string {
	return (
		document.runtime.activeStageId
		?? document.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId
		?? document.configuration.workflow.stageOrder[document.configuration.workflow.stageOrder.length - 1]
		?? 'prd'
	);
}

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

type RepositoryWorkflowDefinitionState =
	| { kind: 'missing'; workflowPath: string }
	| { kind: 'valid'; workflowPath: string; workflow: WorkflowDefinition }
	| { kind: 'invalid'; workflowPath: string; invalidState: RepositoryInvalidStateType };

type RepositoryCodeIndexReadModel = {
	id: string;
	indexedAt: string;
	fileCount: number;
	symbolCount: number;
	relationCount: number;
};

type RepositorySettingsDocumentReadOptions = {
	resolveWorkspaceRoot?: boolean;
	invalidDocument?: 'throw' | 'missing';
};

export class Repository extends Entity<RepositoryType, string> {
	public static override readonly entityName = repositoryEntityName;
	public static readonly storageSchema = RepositoryStorageSchema;
	public static readonly missionDirectoryName = '.open-mission';
	public static readonly defaultMissionsRoot = 'missions';
	public static readonly missionWorkflowDirectoryName = 'workflow';
	public static readonly missionWorkflowDefinitionFileName = 'workflow.json';

	public static async find(
		input: RepositoryFindType = {},
		context?: EntityExecutionContext
	): Promise<RepositoryType[]> {
		const args = RepositoryFindSchema.parse(input);
		const result = await Repository._find(context, args.select ?? {});
		return await Promise.all(result.entities.map((repository) => repository.read({})));
	}

	public static async findAvailable(
		input: RepositoryFindAvailableType = {},
		context?: EntityExecutionContext
	): Promise<RepositoryPlatformRepositoryType[]> {
		const args = RepositoryFindAvailableSchema.parse(input);
		const platform = args.platform ?? 'github';
		const ghBinary = getOpenMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform,
			repositoryRootPath: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return await adapter.listRepositories();
	}

	public static async findAvailableOwners(
		input: RepositoryFindAvailableOwnersType = {},
		context?: EntityExecutionContext
	): Promise<RepositoryPlatformOwnerType[]> {
		const args = RepositoryFindAvailableOwnersSchema.parse(input);
		const platform = args.platform ?? 'github';
		const ghBinary = getOpenMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform,
			repositoryRootPath: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return await adapter.listRepositoryOwners();
	}

	public static async ensureSystemAgentExecution(
		input: RepositoryEnsureSystemAgentExecutionType = {},
		context?: EntityExecutionContext
	): Promise<AgentExecutionType> {
		RepositoryEnsureSystemAgentExecutionSchema.parse(input);
		const openMissionConfig = readOpenMissionConfig() ?? getDefaultOpenMissionConfig();
		const repositoriesRootPath = resolveRepositoriesRoot(openMissionConfig);
		const settings = createDefaultRepositorySettings();
		settings.agentAdapter = openMissionConfig.defaultAgentAdapter;
		settings.enabledAgentAdapters = openMissionConfig.enabledAgentAdapters;
		const agentRegistry = await AgentRegistry.createConfigured({
			repositoryRootPath: repositoriesRootPath,
			settings
		});
		const availableAgentIds = agentRegistry.listAgents()
			.filter((agent) => agent.toData().availability.available)
			.map((agent) => agent.agentId);
		const enabledAgentIds = openMissionConfig.enabledAgentAdapters.length > 0
			? openMissionConfig.enabledAgentAdapters.filter((agentId) => availableAgentIds.includes(agentId))
			: availableAgentIds;
		const requestedAgentId = enabledAgentIds.includes(openMissionConfig.defaultAgentAdapter)
			? openMissionConfig.defaultAgentAdapter
			: enabledAgentIds[0] ?? openMissionConfig.defaultAgentAdapter;
		const agentId = agentRegistry.resolveStartAgentId(requestedAgentId);
		if (!agentId) {
			throw new Error('No repository manager agent is available for the repositories surface.');
		}
		const agentExecutionRegistry = requireAgentExecutionRegistry(context, 'ensureSystemAgentExecution');
		return await agentExecutionRegistry.ensureExecution({
			ownerKey: Repository.createSystemAgentExecutionOwnerKey(repositoriesRootPath),
			agentRegistry,
			config: {
				ownerId: Repository.createSystemAgentExecutionOwnerKey(repositoriesRootPath),
				scope: { kind: 'system' },
				workingDirectory: repositoriesRootPath,
				specification: {
					summary: 'Manage the repositories surface for Open Mission.',
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
			commands: await Repository.commandDescriptors(
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

	public static async canCreatePlatformRepository(input?: unknown, context?: EntityExecutionContext) {
		const result = RepositoryCreateSchema.safeParse(input ?? {});
		if (!result.success) {
			return true;
		}

		const repositoryRef = `${result.data.ownerLogin}/${result.data.repositoryName}`;
		const registeredRepository = await Repository.findRegisteredPlatformRepository(repositoryRef, context);
		return registeredRepository
			? { available: false, reason: `Repository '${repositoryRef}' is already checked out at '${registeredRepository.repositoryRootPath}'.` }
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

	public static async discoverConfiguredRepositories(): Promise<Repository[]> {
		const config = readOpenMissionConfig();
		if (!config) {
			return [];
		}

		const repositoriesRoot = resolveRepositoriesRoot(config);
		const repositoryRootPaths = await Repository.findGitRepositoryRoots(repositoriesRoot);
		return repositoryRootPaths
			.filter((repositoryRootPath) => Repository.isCanonicalCheckoutRoot(repositoryRootPath))
			.map((repositoryRootPath) => Repository.open(repositoryRootPath));
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

	private static isCanonicalCheckoutRoot(repositoryRootPath: string): boolean {
		const resolvedRepositoryRootPath = path.resolve(repositoryRootPath);
		const canonicalRepositoryRootPath = Repository.resolveRepositoryRoot(resolvedRepositoryRootPath);
		return canonicalRepositoryRootPath === resolvedRepositoryRootPath;
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
	): Promise<RepositoryType> {
		const args = RepositoryAddSchema.parse(input);
		const repositoryRootPath = 'repositoryRef' in args
			? await Repository.checkoutPlatformRepositoryAfterDuplicateCheck(args, context)
			: args.repositoryPath;
		const repository = await Repository.addLocalRepository(repositoryRootPath, context);
		await repository.initialize({}, context);
		await Repository.getRepositoryFactory(context).save(Repository, repository.toStorage());
		return await repository.read({});
	}

	public static async createPlatformRepository(
		input: RepositoryCreateType,
		context?: EntityExecutionContext
	): Promise<RepositoryType> {
		const args = RepositoryCreateSchema.parse(input);
		const repositoryRef = `${args.ownerLogin}/${args.repositoryName}`;
		await Repository.assertPlatformRepositoryIsNotRegistered(repositoryRef, context);
		const repositoryRootPath = await Repository.createPlatformRepositoryAfterDuplicateCheck(args, context);
		const repository = await Repository.addLocalRepository(repositoryRootPath, context);
		await repository.initialize({}, context);
		await Repository.syncPreparedRepositorySetupToDefaultBranch(repository.repositoryRootPath);
		await Repository.getRepositoryFactory(context).save(Repository, repository.toStorage());
		return await repository.read({});
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
		return createEntityIdentitySegment(value);
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
			const [scope, repository] = githubRepository
				.split('/')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0);
			if (scope && repository) {
				return path.join(
					Repository.resolveMissionsRoot(options.missionsRoot),
					scope,
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

	private static inspectWorkflowDefinition(
		repositoryRootPath = process.cwd()
	): RepositoryWorkflowDefinitionState {
		const workflowPath = Repository.getMissionWorkflowDefinitionPath(repositoryRootPath);
		try {
			const content = fs.readFileSync(workflowPath, 'utf8').trim();
			if (!content) {
				return { kind: 'missing', workflowPath };
			}
			const parsed = parsePersistedWorkflowSettings(JSON.parse(content) as unknown);
			return {
				kind: 'valid',
				workflowPath,
				workflow: parsed
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
				return { kind: 'missing', workflowPath };
			}
			return {
				kind: 'invalid',
				workflowPath,
				invalidState: {
					code: 'invalid-workflow-definition',
					path: workflowPath,
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}

	private static hasTrackedRepositorySetupOnRef(
		store: MissionDossierFilesystem,
		repositoryRootPath: string,
		ref: string
	): boolean {
		if (!store.refExists(ref, repositoryRootPath)) {
			return false;
		}
		const settingsPath = path.relative(repositoryRootPath, Repository.getSettingsDocumentPath(repositoryRootPath, {
			resolveWorkspaceRoot: false
		}));
		const workflowPath = path.relative(repositoryRootPath, Repository.getMissionWorkflowDefinitionPath(repositoryRootPath));
		return store.refTracksPath(ref, settingsPath, repositoryRootPath)
			&& store.refTracksPath(ref, workflowPath, repositoryRootPath);
	}

	private static inspectTrackedRepositorySetupState(
		store: MissionDossierFilesystem,
		repositoryRootPath: string
	): { localTracked: boolean; remoteTracked: boolean; baseBranch?: string } {
		if (!store.isGitRepository()) {
			return { localTracked: false, remoteTracked: false };
		}
		const baseBranch = store.getDefaultBranch();
		return {
			baseBranch,
			localTracked: Repository.hasTrackedRepositorySetupOnRef(store, repositoryRootPath, `refs/heads/${baseBranch}`),
			remoteTracked: Repository.hasTrackedRepositorySetupOnRef(store, repositoryRootPath, `refs/remotes/origin/${baseBranch}`)
		};
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

	private static async syncPreparedRepositorySetupToDefaultBranch(repositoryRootPath: string): Promise<void> {
		const store = new MissionDossierFilesystem(repositoryRootPath);
		if (!store.isGitRepository()) {
			throw new Error(`Repository '${repositoryRootPath}' is not a Git repository.`);
		}

		const settingsState = Repository.inspectSettingsDocument(repositoryRootPath);
		const settings = settingsState.kind === 'valid'
			? settingsState.settings
			: await Repository.createPreparedRepositorySettings(repositoryRootPath);
		const scaffolding = await Repository.initializeScaffolding(repositoryRootPath, { settings });
		const baseBranch = store.getDefaultBranch();
		const currentBranch = store.getCurrentBranch();
		if (currentBranch !== baseBranch) {
			throw new Error(`Repository '${repositoryRootPath}' must be on '${baseBranch}' to finalize setup.`);
		}

		store.stagePaths([
			path.relative(repositoryRootPath, scaffolding.settingsDocumentPath),
			path.relative(repositoryRootPath, scaffolding.workflowDirectoryPath)
		], repositoryRootPath, { force: true });
		if (store.isWorktreeClean(repositoryRootPath)) {
			return;
		}

		store.commit(Repository.buildRepositorySetupCommitMessage(), repositoryRootPath);
		store.pushBranch(baseBranch, repositoryRootPath);
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
		const ghBinary = getOpenMissionGitHubCliBinary();
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

	private static async createPlatformRepositoryAfterDuplicateCheck(
		input: RepositoryCreateType,
		context?: EntityExecutionContext
	): Promise<string> {
		const ghBinary = getOpenMissionGitHubCliBinary();
		const adapter = createRepositoryPlatformAdapter({
			platform: input.platform,
			repositoryRootPath: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});

		return adapter.createRepository({
			ownerLogin: input.ownerLogin,
			repositoryName: input.repositoryName,
			destinationPath: input.destinationPath,
			visibility: input.visibility
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

	private static readCheckoutState(repositoryRootPath: string): 'checked-out' | 'not-found' {
		return Repository.isLiveRepositoryRoot(repositoryRootPath)
			? 'checked-out'
			: 'not-found';
	}

	public constructor(data: RepositoryStorageType | RepositoryType) {
		const defaults = createDefaultRepositoryConfiguration();
		super(RepositorySchema.parse({
			...defaults,
			...data
		}));
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
		this.data = RepositorySchema.parse({
			...this.data,
			settings: RepositorySettingsSchema.parse(settings)
		});
		return this;
	}

	public updateWorkflowConfiguration(workflowConfiguration: WorkflowDefinition): this {
		this.data = RepositorySchema.parse({
			...this.data,
			workflowConfiguration: RepositoryWorkflowConfigurationSchema.parse(workflowConfiguration)
		});
		return this;
	}

	public markInitialized(value = true): this {
		this.data = RepositorySchema.parse({
			...this.data,
			isInitialized: value
		});
		return this;
	}

	public toStorage(): RepositoryStorageType {
		const {
			settings: _settings,
			workflowConfiguration: _workflowConfiguration,
			isInitialized: _isInitialized,
			checkoutState: _checkoutState,
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

	public canIndexCode() {
		if (this.invalidState && !this.isRecoverableSetupState()) {
			return this.unavailable(Repository.describeInvalidState(this.invalidState));
		}
		if (!Repository.isLiveRepositoryRoot(this.repositoryRootPath)) {
			return this.unavailable('Repository root does not exist.');
		}
		return this.available();
	}

	public async initialize(
		input: RepositoryInitializeType,
		context?: EntityExecutionContext
	): Promise<RepositoryInitializeResultType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInitializeSchema.parse(Repository.stripRepositoryTarget(input));
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
			await Repository.tryEnsurePreparedCodeIndex(this.repositoryRootPath, context, this.id);
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
		await Repository.tryEnsurePreparedCodeIndex(this.repositoryRootPath, context, this.id);
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
	): Promise<RepositoryType> {
		return this.configureAgent(RepositoryConfigureAgentsSchema.parse(input), context);
	}

	public async configureAgent(
		input: RepositoryConfigureAgentType,
		context?: EntityExecutionContext
	): Promise<RepositoryType> {
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositoryConfigureAgentSchema.parse(Repository.stripRepositoryTarget(input));

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

		const defaultAgentChanged = currentSettings.agentAdapter !== args.defaultAgentAdapter;
		const nextSettings = RepositorySettingsSchema.parse({
			...currentSettings,
			agentAdapter: args.defaultAgentAdapter,
			enabledAgentAdapters: requestedEnabledAgentIds,
			defaultAgentMode: args.defaultAgentMode ?? currentSettings.defaultAgentMode,
			defaultModel: args.defaultModel ?? (defaultAgentChanged ? undefined : currentSettings.defaultModel),
			defaultReasoningEffort: args.defaultReasoningEffort ?? (defaultAgentChanged ? undefined : currentSettings.defaultReasoningEffort)
		});
		await Repository.writeSettingsDocument(nextSettings, this.repositoryRootPath, { resolveWorkspaceRoot: false });
		this.updateSettings(nextSettings);
		await Repository.getRepositoryFactory(context).save(Repository, this.toStorage());
		if (currentSettings.agentAdapter !== nextSettings.agentAdapter) {
			await this.replaceActiveRepositoryAgentExecution(nextSettings, context);
		}
		return await this.read({});
	}

	public async configureDisplay(
		input: RepositoryConfigureDisplayType,
		context?: EntityExecutionContext
	): Promise<RepositoryType> {
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositoryConfigureDisplaySchema.parse(Repository.stripRepositoryTarget(input));

		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (settingsState.kind === 'invalid') {
			throw new Error(Repository.describeInvalidState(settingsState.invalidState));
		}

		const currentSettings = settingsState.kind === 'valid'
			? settingsState.settings
			: await Repository.createPreparedRepositorySettings(this.repositoryRootPath);
		const { icon: _currentIcon, ...baseSettings } = currentSettings;
		const nextSettings = RepositorySettingsSchema.parse({
			...baseSettings,
			...(args.icon ? { icon: args.icon } : {})
		});
		await Repository.writeSettingsDocument(nextSettings, this.repositoryRootPath, { resolveWorkspaceRoot: false });
		this.updateSettings(nextSettings);
		await Repository.getRepositoryFactory(context).save(Repository, this.toStorage());
		return await this.read({});
	}

	public async ensureRepositoryAgentExecution(
		input: RepositoryInitializeType,
		context?: EntityExecutionContext
	): Promise<AgentExecutionType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInitializeSchema.parse(Repository.stripRepositoryTarget(input));
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
		const agentExecutionRegistry = requireAgentExecutionRegistry(context, 'ensureRepositoryAgentExecution');
		const ownerKey = Repository.createRepositoryAgentExecutionOwnerKey(this.repositoryRootPath);
		const reusableExecution = typeof agentExecutionRegistry.readReusableExecution === 'function'
			? agentExecutionRegistry.readReusableExecution({
				ownerKey,
				requestedAgentId: agentId
			})
			: undefined;
		if (reusableExecution) {
			return reusableExecution;
		}
		const initialPromptText = await this.buildRepositoryAgentPrompt(context);
		return agentExecutionRegistry.ensureExecution({
			ownerKey,
			agentRegistry,
			config: {
				ownerId: ownerKey,
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

	public async refreshRepositoryAgentExecution(
		input: RepositoryInitializeType,
		context?: EntityExecutionContext
	): Promise<AgentExecutionType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInitializeSchema.parse(Repository.stripRepositoryTarget(input));
		this.assertCanLaunchRepositoryAgentExecution();
		await this.ensurePreparedForRepositoryAgentExecution(context);

		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		const setupSettings = settingsState.kind === 'valid'
			? settingsState.settings
			: createDefaultRepositorySettings();
		const replacedExecution = await this.replaceActiveRepositoryAgentExecution(setupSettings, context);
		if (replacedExecution) {
			return replacedExecution;
		}

		return this.ensureRepositoryAgentExecution({}, context);
	}

	public async indexCode(
		input: RepositoryInstanceInputType,
		context?: EntityExecutionContext
	): Promise<RepositoryCodeIndexAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		const availability = this.canIndexCode();
		if (!availability.available) {
			throw new Error(availability.reason ?? 'Repository code indexing is unavailable.');
		}

		const index = await Repository.ensurePreparedCodeIndex(this.repositoryRootPath, context, this.id);
		const snapshot = index;
		return RepositoryCodeIndexAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'indexCode',
			id: this.id,
			snapshotId: snapshot.id,
			indexedAt: snapshot.indexedAt,
			fileCount: snapshot.fileCount,
			symbolCount: snapshot.symbolCount,
			relationCount: snapshot.relationCount
		});
	}

	private async replaceActiveRepositoryAgentExecution(
		settings: RepositorySettingsType,
		context?: EntityExecutionContext
	): Promise<AgentExecutionType | undefined> {
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
			return undefined;
		}

		const agentExecutionRegistry = requireAgentExecutionRegistry(context, 'refreshRepositoryAgentExecution');
		if (typeof agentExecutionRegistry.replaceActiveExecution !== 'function') {
			throw new Error('Repository refreshRepositoryAgentExecution requires replaceActiveExecution support in the agentExecutionRegistry capability.');
		}
		const initialPromptText = await this.buildRepositoryAgentPrompt(context);
		return await agentExecutionRegistry.replaceActiveExecution({
			ownerKey: Repository.createRepositoryAgentExecutionOwnerKey(this.repositoryRootPath),
			agentRegistry,
			config: {
				ownerId: Repository.createRepositoryAgentExecutionOwnerKey(this.repositoryRootPath),
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
			'You are the system-scoped repositories manager for Open Mission.',
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
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositorySetupSchema.parse(Repository.stripRepositoryTarget(input));
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			throw new Error(`Repository '${this.id}' does not have a platform repository ref configured.`);
		}
		if (this.invalidState && !this.isRecoverableSetupState()) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		const workflowState = Repository.inspectWorkflowDefinition(this.repositoryRootPath);
		if (this.isInitialized || (settingsState.kind === 'valid' && workflowState.kind === 'valid')) {
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
			if (autoMerge.merged) {
				await Repository.tryEnsurePreparedCodeIndex(this.repositoryRootPath, context, this.id);
			}
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

	private static async tryEnsurePreparedCodeIndex(
		repositoryRootPath: string,
		context?: EntityExecutionContext,
		repositoryId?: string
	): Promise<void> {
		try {
			await Repository.ensurePreparedCodeIndex(repositoryRootPath, context, repositoryId);
		} catch {
			// Code intelligence is derived read material; repository preparation must not fail because indexing is unavailable.
		}
	}

	private static async ensurePreparedCodeIndex(
		repositoryRootPath: string,
		context?: EntityExecutionContext,
		repositoryId?: string
	): Promise<RepositoryCodeIndexReadModel> {
		const service = requireCodeIntelligenceService(context, 'ensurePreparedCodeIndex');
		return Repository.parseCodeIndexReadModel(await service.ensureIndex({
			repositoryId: repositoryId ?? Repository.deriveIdentity(repositoryRootPath).id,
			rootPath: repositoryRootPath
		}));
	}

	private static parseCodeIndexReadModel(input: unknown): RepositoryCodeIndexReadModel {
		if (!input || typeof input !== 'object') {
			throw new Error('Code intelligence service did not return an index snapshot.');
		}
		const record = input as Record<string, unknown>;
		if (typeof record['id'] !== 'string' || typeof record['indexedAt'] !== 'string') {
			throw new Error('Code intelligence service returned an invalid index snapshot identity.');
		}
		const objects = Array.isArray(record['objects']) ? record['objects'] : undefined;
		const relations = Array.isArray(record['relations']) ? record['relations'] : undefined;
		if (!objects || !relations) {
			throw new Error('Code intelligence service returned an invalid hydrated graph snapshot.');
		}
		const fileCount = objects.filter((object) => {
			return object && typeof object === 'object'
				&& ((object as { objectKind?: unknown }).objectKind === 'file'
					|| (object as { objectKind?: unknown }).objectKind === 'document');
		}).length;
		const symbolCount = objects.filter((object) => {
			return object && typeof object === 'object'
				&& (object as { objectKind?: unknown }).objectKind === 'symbol';
		}).length;
		const relationCount = relations.length;
		if (typeof fileCount !== 'number' || typeof symbolCount !== 'number' || typeof relationCount !== 'number') {
			throw new Error('Code intelligence service returned invalid index counts.');
		}
		return {
			id: record['id'],
			indexedAt: record['indexedAt'],
			fileCount,
			symbolCount,
			relationCount
		};
	}

	public override async remove(
		input: RepositoryInstanceInputType,
		context?: EntityExecutionContext
	): Promise<RepositoryRemoveAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		const repositoryRootPath = await Repository.assertRemovableRepositoryRoot(this.repositoryRootPath);
		await Repository.removeMissionWorktreeRoot(repositoryRootPath);
		await fsp.rm(repositoryRootPath, { recursive: true });
		await this.getEntityFactory(context).remove(Repository, this.id);
		return RepositoryRemoveAcknowledgementSchema.parse({
			ok: true,
			entity: repositoryEntityName,
			method: 'remove',
			id: this.id
		});
	}

	private static async removeMissionWorktreeRoot(repositoryRootPath: string): Promise<void> {
		const store = new MissionDossierFilesystem(repositoryRootPath);
		const missionWorktreesPath = store.getMissionsPath();
		const missions = await store.listMissions().catch(() => []);

		for (const { descriptor } of missions) {
			await store.removeLinkedWorktree(store.getMissionWorktreePath(descriptor.missionId)).catch(() => undefined);
		}

		if (missionWorktreesPath === repositoryRootPath) {
			return;
		}

		await fsp.rm(missionWorktreesPath, { recursive: true, force: true }).catch(() => undefined);
	}

	private static async buildRemovalSummaryMission(
		store: MissionDossierFilesystem,
		missionDir: string,
		descriptor: MissionDescriptor
	): Promise<RepositoryRemovalSummaryMissionType> {
		const missionState = await Repository.readMissionStateSummary(store, missionDir);
		const missionWorktreePath = store.getMissionWorktreePath(descriptor.missionId);

		return {
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			branchRef: descriptor.branchRef,
			createdAt: descriptor.createdAt,
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {}),
			lifecycle: missionState?.runtime.lifecycle ?? 'draft',
			...(missionState ? { currentStageId: resolveWorkflowCurrentStage(missionState) } : {}),
			activeAgentExecutionCount: missionState
				? missionState.runtime.agentExecutions.filter((execution) => isActiveAgentExecutionLifecycle(execution.lifecycle)).length
				: 0,
			missionRootPath: missionDir,
			missionWorktreePath,
			worktree: store.getWorktreeStatus(missionWorktreePath)
		};
	}

	private static async readMissionStateSummary(
		store: MissionDossierFilesystem,
		missionDir: string
	): Promise<WorkflowStateData | undefined> {
		const rawData = await store.readWorkflowStateDataFile(missionDir).catch(() => undefined);
		const parsed = WorkflowStateDataSchema.safeParse(rawData);
		return parsed.success ? parsed.data : undefined;
	}

	public async read(input: RepositoryInstanceInputType): Promise<RepositoryType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const defaults = createDefaultRepositoryConfiguration();
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		const workflowState = Repository.inspectWorkflowDefinition(this.repositoryRootPath);
		const trackedSetupState = Repository.inspectTrackedRepositorySetupState(store, this.repositoryRootPath);
		const currentBranch = store.isGitRepository() ? store.getCurrentBranch() : undefined;
		const checkoutState = Repository.readCheckoutState(this.repositoryRootPath);
		if (workflowState.kind === 'invalid') {
			this.data = RepositorySchema.parse({
				...defaults,
				...this.toStorage(),
				...(settingsState.kind === 'valid' ? { settings: settingsState.settings } : {}),
				checkoutState,
				operationalMode: 'setup',
				invalidState: workflowState.invalidState,
				...(currentBranch ? { currentBranch } : {}),
				isInitialized: false
			});
			return this.toData();
		}
		if (settingsState.kind === 'invalid') {
			this.data = RepositorySchema.parse({
				...defaults,
				...this.toStorage(),
				checkoutState,
				operationalMode: 'setup',
				...(currentBranch ? { currentBranch } : {}),
				isInitialized: false
			});
			return this.toData();
		}

		const hasRepositorySetupState = settingsState.kind === 'valid'
			&& workflowState.kind === 'valid'
			&& trackedSetupState.localTracked
			&& trackedSetupState.remoteTracked;
		this.data = RepositorySchema.parse({
			...defaults,
			...this.toStorage(),
			...(settingsState.kind === 'valid' ? { settings: settingsState.settings } : {}),
			...(workflowState.kind === 'valid' ? { workflowConfiguration: workflowState.workflow } : {}),
			checkoutState,
			operationalMode: this.isInitialized || hasRepositorySetupState ? 'repository' : 'setup',
			...(currentBranch ? { currentBranch } : {}),
			isInitialized: this.isInitialized || hasRepositorySetupState
		});
		return this.toData();
	}

	public async syncStatus(input: RepositoryInstanceInputType, context?: EntityExecutionContext): Promise<RepositorySyncStatusType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		return RepositorySyncStatusSchema.parse(this.buildSyncStatus(context?.authToken));
	}

	public async readRemovalSummary(input: RepositoryReadRemovalSummaryType): Promise<RepositoryRemovalSummaryType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryReadRemovalSummarySchema.parse(Repository.stripRepositoryTarget(input));
		const store = new MissionDossierFilesystem(this.repositoryRootPath);
		const missionWorktreesPath = store.getMissionsPath();
		const missions = await store.listMissions().catch(() => []);
		const missionSummaries = await Promise.all(missions.map(async ({ missionDir, descriptor }) =>
			Repository.buildRemovalSummaryMission(store, missionDir, descriptor)
		));
		const activeAgentExecutionCount = missionSummaries.reduce(
			(total, mission) => total + mission.activeAgentExecutionCount,
			0
		);

		return RepositoryRemovalSummarySchema.parse({
			id: this.id,
			repositoryRootPath: this.repositoryRootPath,
			missionWorktreesPath,
			hasExternalMissionWorktrees: missionWorktreesPath !== this.repositoryRootPath,
			repositoryWorktree: store.getWorktreeStatus(this.repositoryRootPath),
			missionCount: missionSummaries.length,
			dirtyMissionCount: missionSummaries.filter((mission) => !mission.worktree.clean).length,
			missionsWithActiveAgentExecutionsCount: missionSummaries.filter((mission) => mission.activeAgentExecutionCount > 0).length,
			activeAgentExecutionCount,
			missions: missionSummaries
		});
	}

	public async readCodeGraphSnapshot(
		input: RepositoryReadCodeGraphSnapshotType,
		context?: EntityExecutionContext
	): Promise<RepositoryCodeGraphSnapshotType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryReadCodeGraphSnapshotSchema.parse(Repository.stripRepositoryTarget(input));
		const service = readCodeIntelligenceService(context);
		if (!service?.readActiveIndex) {
			return RepositoryCodeGraphSnapshotSchema.parse(null);
		}
		return RepositoryCodeGraphSnapshotSchema.parse(
			await service.readActiveIndex({ repositoryId: this.id, rootPath: this.repositoryRootPath })
		);
	}

	public async fetchExternalState(
		input: RepositoryInstanceInputType,
		context?: EntityExecutionContext
	): Promise<RepositorySyncCommandAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
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
		input: RepositoryInstanceInputType,
		context?: EntityExecutionContext
	): Promise<RepositorySyncCommandAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
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

	public async commands(input: RepositoryInstanceInputType, context?: EntityExecutionContext): Promise<EntityCommandViewType> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		await this.read(input);
		const { RepositoryContract } = await import('./RepositoryContract.js');
		const missionRegistry = readContextCapability<unknown>(context, 'missionRegistry');
		const missionService = readContextCapability<unknown>(context, 'missionService');
		return EntityCommandViewSchema.parse({
			id: this.id,
			commands: await this.commandDescriptors(RepositoryContract, {
				surfacePath: this.repositoryRootPath,
				...(context?.authToken ? { authToken: context.authToken } : {}),
				...(missionRegistry ? { missionRegistry } : {}),
				...(missionService ? { missionService } : {}),
				...(context?.entityFactory ? { entityFactory: context.entityFactory } : {})
			})
		});
	}

	public async listIssues(
		input: RepositoryInstanceInputType,
		context?: { authToken?: string }
	): Promise<TrackedIssueSummaryType[]> {
		this.assertRepositoryIdentityIfPresent(input);
		RepositoryInstanceInputSchema.parse(Repository.stripRepositoryTarget(input));
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
		return TrackedIssueSummarySchema.array().parse(platform ? await platform.listOpenIssues(25) : []);
	}

	public async getIssue(
		input: RepositoryGetIssueType,
		context?: { authToken?: string }
	): Promise<RepositoryIssueDetailType> {
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositoryGetIssueSchema.parse(Repository.stripRepositoryTarget(input));
		return RepositoryIssueDetailSchema.parse(
			await this.requireRepositoryPlatformAdapter(context?.authToken)
				.fetchIssueDetail(String(args.issueNumber))
		);
	}

	public async startMissionFromIssue(
		input: RepositoryStartMissionFromIssueType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositoryStartMissionFromIssueSchema.parse(Repository.stripRepositoryTarget(input));
		await this.refreshRepositoryControlState();
		this.assertCanStartRegularMission();
		const brief = await this.requireRepositoryPlatformAdapter(context?.authToken)
			.fetchIssue(String(args.issueNumber));
		return this.prepareMission(brief, 'startMissionFromIssue');
	}

	public async startMissionFromBrief(
		input: RepositoryStartMissionFromBriefType,
		context?: { authToken?: string }
	): Promise<RepositoryMissionStartAcknowledgementType> {
		this.assertRepositoryIdentityIfPresent(input);
		const args = RepositoryStartMissionFromBriefSchema.parse(Repository.stripRepositoryTarget(input));
		await this.refreshRepositoryControlState();
		this.assertCanStartRegularMission();
		const platform = this.tryCreateRepositoryPlatformAdapter(context?.authToken);
		const baseBrief = {
			title: args.title,
			body: args.body,
			type: args.type,
			...(args.assignee ? { assignee: args.assignee } : {})
		};
		const brief = platform
			? await platform.createIssue({
				title: args.title,
				body: args.body
			}).then((createdIssue) => ({
				...baseBrief,
				...(createdIssue.issueId !== undefined ? { issueId: createdIssue.issueId } : {}),
				...(createdIssue.url ? { url: createdIssue.url } : {}),
				...(createdIssue.labels ? { labels: createdIssue.labels } : {})
			}))
			: baseBrief;

		return this.prepareMission(brief, 'startMissionFromBrief');
	}

	private assertCanStartRegularMission(): void {
		if (this.invalidState) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		if (!this.isInitialized) {
			throw new Error('Complete Repository setup and sync the default branch to GitHub before starting regular missions.');
		}
	}

	private static describeInvalidState(invalidState: RepositoryInvalidStateType): string {
		return `Repository control state is invalid at '${invalidState.path}': ${invalidState.message}`;
	}

	private isRecoverableSetupState(): boolean {
		return this.invalidState?.code === 'invalid-settings-document'
			|| this.invalidState?.code === 'invalid-workflow-definition';
	}

	private assertCanLaunchRepositoryAgentExecution(): void {
		if (this.invalidState && !this.isRecoverableSetupState()) {
			throw new Error(Repository.describeInvalidState(this.invalidState));
		}
		if (!Repository.isCanonicalCheckoutRoot(this.repositoryRootPath)) {
			throw new Error(
				`Repository '${this.id}' is a linked worktree. Repository-level AgentExecution is only allowed from the canonical repository checkout at '${Repository.resolveRepositoryRoot(this.repositoryRootPath)}'.`
			);
		}
	}

	private async ensurePreparedForRepositoryAgentExecution(context?: EntityExecutionContext): Promise<void> {
		const settingsState = Repository.inspectSettingsDocument(this.repositoryRootPath);
		if (settingsState.kind !== 'valid') {
			await this.initialize({}, context);
		}
	}

	private async buildRepositoryAgentPrompt(_context?: EntityExecutionContext): Promise<string> {
		return [
			`This session is attached to the repository ${this.platformRepositoryRef ?? this.repoName} in Mission.`,
			"Wait for the operator's first task.",
			'Repository initialization and recovery tasks may be requested later in this session.',
			'Keep the conversation concise and focused on the requested repository task.'
		].join('\n');
	}

	private static createRepositoryAgentExecutionOwnerKey(repositoryRootPath: string): string {
		return `Repository.agentExecution:${repositoryRootPath}`;
	}

	private static createSystemAgentExecutionOwnerKey(repositoriesRootPath: string): string {
		return `Repository.systemAgentExecution:${repositoriesRootPath}`;
	}

	private async refreshRepositoryControlState(): Promise<void> {
		await this.read({});
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
		const missionId = store.createMissionId(brief);
		const missionWorktreePath = store.getMissionWorktreePath(missionId);
		const preparation = await Mission.prepareFromBrief(store, {
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
		}, {
			brief,
			stageRelativePaths: [
				path.relative(missionWorktreePath, Repository.getSettingsDocumentPath(missionWorktreePath, {
					resolveWorkspaceRoot: false
				})),
				path.relative(missionWorktreePath, path.dirname(Repository.getMissionWorkflowDefinitionPath(missionWorktreePath))),
				path.relative(missionWorktreePath, store.getTrackedMissionDir(missionId, missionWorktreePath))
			],
			commitMessage: Repository.buildMissionPreparationCommitMessage(missionId, brief)
		});

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

	private async ensureMissionWorktreeOnBranch(
		store: MissionDossierFilesystem,
		missionWorktreePath: string,
		branchRef: string,
		baseBranch: string
	): Promise<void> {
		await Mission.ensureWorktreeOnBranch(store, missionWorktreePath, branchRef, baseBranch);
	}

	private async assertExistingMissionRuntimeDataValid(
		adapter: MissionDossierFilesystem,
		missionDir: string,
		missionId: string
	): Promise<void> {
		await Mission.assertRuntimeDataValid(adapter, missionDir, missionId);
	}

	private tryCreateRepositoryPlatformAdapter(authToken?: string) {
		const platformRepositoryRef = this.platformRepositoryRef?.trim();
		if (!platformRepositoryRef) {
			return undefined;
		}

		const ghBinary = getOpenMissionGitHubCliBinary();
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

	private assertRepositoryIdentityIfPresent(input: unknown): void {
		const inputRecord = Repository.isRecord(input) ? input : undefined;
		if (!inputRecord) {
			return;
		}
		if (inputRecord['id'] === undefined && inputRecord['repositoryRootPath'] === undefined) {
			return;
		}
		const args = RepositoryLocatorSchema.parse({
			id: inputRecord['id'],
			...(typeof inputRecord['repositoryRootPath'] === 'string'
				? { repositoryRootPath: inputRecord['repositoryRootPath'] }
				: {})
		});
		this.assertRepositoryIdentity(args);
	}

	private static stripRepositoryTarget(input: unknown): unknown {
		if (!Repository.isRecord(input)) {
			return input;
		}
		const { id: _id, repositoryRootPath: _repositoryRootPath, ...payload } = input;
		return payload;
	}

	private static createRepositoryData(input: RepositoryInputType): RepositoryType {
		const normalizedRepositoryRootPath = path.resolve(input.repositoryRootPath);
		const identity = Repository.deriveIdentity(normalizedRepositoryRootPath);
		const explicitPlatformRepositoryRef = input.platformRepositoryRef?.trim();
		const platformRepositoryRef = explicitPlatformRepositoryRef || identity.platformRepositoryRef;
		const { ownerId, repoName } = Repository.deriveRepositoryNames(normalizedRepositoryRootPath, platformRepositoryRef);
		const defaults = createDefaultRepositoryConfiguration();

		return RepositorySchema.parse({
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
		const [scope, repository, ...rest] = value?.trim().split('/').map((segment) => segment.trim()) ?? [];
		if (!scope || !repository || rest.length > 0) {
			return undefined;
		}
		return `${scope}/${repository}`;
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
			'- Creates `.open-mission/settings.json` for Repository control settings.',
			'- Creates `.open-mission/workflow/workflow.json` and the default workflow template preset.',
			'- Leaves Mission dossiers to future Mission branches.',
			'',
			'After this PR merges, update the local default branch before starting missions.'
		].join('\n');
	}

	private static getRepositoryFactory(context?: EntityExecutionContext) {
		return Repository.getEntityFactory(context);
	}
}

export type {
	RepositoryStorageType,
	RepositoryInputType
};
