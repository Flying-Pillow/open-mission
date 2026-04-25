import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Entity } from '../Entity.js';
import type {
	GitHubIssueDetail,
	GitHubVisibleRepository,
	MissionBrief,
	OperatorActionDescriptor,
	OperatorActionExecutionSelectionStep,
	OperatorActionExecutionStep,
	OperatorActionExecutionTextStep,
	OperatorActionFlowDescriptor,
	OperatorActionFlowOption,
	OperatorActionQueryContext,
	OperatorStatus,
	OperatorActionListSnapshot,
	MissionOperationalMode,
	MissionSelectionCandidate,
	RepositoryControlStatus,
	TrackedIssueSummary,
	RepositoryCandidate
} from '../../types.js';
import {
	getWorkflowSettingsDocumentPath,
	readWorkflowSettingsDocument,
	resolveWorkflowSettingsDocument,
	writeWorkflowSettingsDocument
} from '../../lib/daemonConfig.js';
import {
	createDefaultRepositoryWorkflowSettingsDocument,
	type RepositoryWorkflowSettingsDocument as WorkflowSettingsDocument
} from './RepositorySettingsDocument.js';
import {
	listRegisteredRepositories,
	registerMissionRepo
} from '../../lib/config.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { orderAvailableActions, resolveAvailableActionsForTargetContext } from '../../lib/operatorActionTargeting.js';
import {
	GitHubPlatformAdapter,
	type GitHubBranchSyncStatus,
	resolveGitHubRepositoryFromWorkspace
} from '../../platforms/GitHubPlatformAdapter.js';
import { deriveRepositoryIdentity } from '../../lib/repositoryIdentity.js';
import {
	getMissionDirectoryPath,
	getMissionWorkflowDefinitionPath,
	getMissionWorktreesPath
} from '../../lib/repoConfig.js';
import { refreshSystemStatus } from '../../system/SystemStatus.js';
import type { MissionWorkflowBindings } from '../../mission/Mission.js';
import { MissionPreparationService } from '../../mission/MissionPreparationService.js';
import type {
	ControlActionDescribe,
	ControlActionExecute,
	ControlActionList,
	ControlGitHubIssueDetail,
	ControlGitHubRepositoriesClone,
	ControlSettingsUpdate,
	MissionFromBriefRequest,
	MissionFromIssueRequest,
	MissionSelect,
	Request
} from '../../daemon/protocol/contracts.js';
import type { ControlSource } from '../../daemon/control-plane/types.js';
import {
	missionReferenceSchema,
	repositorySchema,
	type MissionReference,
	type RepositoryData,
	type RepositoryStateSnapshot
} from './RepositorySchema.js';
import type { RepositoryPlatformAdapter } from './PlatformAdapter.js';

type MissionSelectionCacheEntry = {
	expiresAt: number;
	candidates: MissionSelectionCandidate[];
};

export type RepositoryWorkspaceHost = {
	store: FilesystemAdapter;
	resolveMissionOperatorStatus(input: MissionSelect): Promise<OperatorStatus>;
	resolveLoadedMissionStatus(missionId: string): Promise<OperatorStatus | undefined>;
	buildWorkflowBindings(): MissionWorkflowBindings;
};

const MISSION_SELECTION_CACHE_TTL_MS = 2000;

export class Repository extends Entity<RepositoryData, string, OperatorActionListSnapshot> {
	private workspaceHost: RepositoryWorkspaceHost | undefined;
	private missionSelectionCache: MissionSelectionCacheEntry | undefined;

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

	public static toMissionReference(candidate: MissionSelectionCandidate): MissionReference {
		return missionReferenceSchema.parse({
			missionId: candidate.missionId,
			title: candidate.title,
			branchRef: candidate.branchRef,
			createdAt: candidate.createdAt,
			...(candidate.issueId !== undefined ? { issueId: candidate.issueId } : {})
		});
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

	protected attachWorkspaceHost(host: RepositoryWorkspaceHost): this {
		this.workspaceHost = host;
		return this;
	}

	public async listMissionSelectionCandidates(): Promise<MissionSelectionCandidate[]> {
		const host = this.requireWorkspaceHost();
		const now = Date.now();
		const cached = this.missionSelectionCache;
		if (cached && cached.expiresAt > now) {
			return cached.candidates.map((candidate) => structuredClone(candidate));
		}

		const candidates = (await host.store.listMissions()).map(({ descriptor }) => ({
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			branchRef: descriptor.branchRef,
			createdAt: descriptor.createdAt,
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
		}));

		this.missionSelectionCache = {
			expiresAt: now + MISSION_SELECTION_CACHE_TTL_MS,
			candidates: candidates.map((candidate) => structuredClone(candidate))
		};

		return candidates;
	}

	public async listOpenIssues(limit = 50, authToken?: string): Promise<TrackedIssueSummary[]> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			return [];
		}

		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requireGitHubAuthentication(normalizedToken);
		const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.listOpenIssues(boundedLimit);
	}

	public async listVisibleGitHubRepositories(authToken?: string): Promise<GitHubVisibleRepository[]> {
		const platformAdapter = this.resolvePlatformAdapter(authToken);
		if (!platformAdapter) {
			return [];
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requireGitHubAuthentication(normalizedToken);
		refreshSystemStatus({
			cwd: this.repositoryRootPath,
			...(normalizedToken ? { authToken: normalizedToken } : {})
		});
		return platformAdapter.listVisibleRepositories();
	}

	public async getGitHubIssueDetail(
		params: ControlGitHubIssueDetail,
		authToken?: string
	): Promise<GitHubIssueDetail> {
		const platformAdapter = this.resolvePlatformAdapter(authToken, { requireRepository: true });
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requireGitHubAuthentication(normalizedToken);
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

	public async cloneGitHubRepository(
		params: ControlGitHubRepositoriesClone,
		authToken?: string
	): Promise<Repository> {
		const platformAdapter = this.resolvePlatformAdapter(authToken);
		if (!platformAdapter) {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}
		const normalizedToken = this.normalizeAuthToken(authToken);
		this.requireGitHubAuthentication(normalizedToken);
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
		this.requireGitHubAuthentication(normalizedToken);
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
		this.requireGitHubAuthentication(normalizedToken);
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
	}): GitHubBranchSyncStatus {
		const adapter = new GitHubPlatformAdapter(
			input.workspaceRoot,
			input.repository,
			input.ghBinary ? { ghBinary: input.ghBinary } : {}
		);
		adapter.fetchRemote('origin');
		return adapter.getBranchSyncStatus(input.branchRef, 'origin');
	}

	public pullWorkspaceBranch(input: {
		workspaceRoot: string;
		branchRef: string;
		repository?: string;
		ghBinary?: string;
	}): void {
		const adapter = new GitHubPlatformAdapter(
			input.workspaceRoot,
			input.repository,
			input.ghBinary ? { ghBinary: input.ghBinary } : {}
		);
		adapter.pullBranch(input.branchRef, 'origin');
	}

	public buildDiscoveryStatus(input: {
		control: RepositoryControlStatus;
		availableMissions?: MissionSelectionCandidate[];
		availableRepositories?: ControlSource['availableRepositories'];
	}): OperatorStatus {
		return {
			found: false,
			operationalMode: input.control.problems.length > 0 ? 'setup' : 'root',
			control: input.control,
			...(input.availableRepositories && input.availableRepositories.length > 0
				? { availableRepositories: input.availableRepositories }
				: {}),
			...(input.availableMissions && input.availableMissions.length > 0
				? { availableMissions: input.availableMissions }
				: {})
		};
	}

	public buildControlSource(input: {
		control: RepositoryControlStatus;
		availableRepositories?: ControlSource['availableRepositories'];
		availableMissions: MissionSelectionCandidate[];
		missionStatus?: OperatorStatus;
	}): ControlSource {
		return {
			repositoryId: this.repositoryId,
			repositoryRootPath: this.repositoryRootPath,
			control: input.control,
			availableRepositories: input.availableRepositories ?? [],
			availableMissions: input.availableMissions,
			...(input.missionStatus ? { missionStatus: input.missionStatus } : {})
		};
	}

	public buildDiscoveryAvailableActions(input: {
		control: RepositoryControlStatus;
		availableMissions: MissionSelectionCandidate[];
		openIssues: TrackedIssueSummary[];
		setupFlow: OperatorActionFlowDescriptor;
		missionStartFlow: OperatorActionFlowDescriptor;
		missionSwitchFlow: OperatorActionFlowDescriptor;
		missionIssueFlow: OperatorActionFlowDescriptor;
	}): OperatorActionDescriptor[] {
		const repositoryPresentationTargets = [{
			scope: 'repository' as const,
			targetId: this.repositoryId
		}];
		const issuesCommandEnabled =
			input.control.trackingProvider === 'github'
			&& input.control.issuesConfigured;
		const issuesCommandReason =
			input.control.trackingProvider !== 'github'
				? 'GitHub tracking is not configured for this repository.'
				: !input.control.issuesConfigured
					? 'GitHub repository configuration is incomplete.'
					: '';
		return [
			{
				id: 'control.repository.init',
				label: 'Prepare the first repository initialization mission',
				action: '/init',
				scope: 'mission',
				disabled: input.control.initialized,
				disabledReason: input.control.initialized ? 'This checkout already contains Mission control scaffolding.' : '',
				enabled: !input.control.initialized,
				ordering: { group: 'recovery' as const },
				ui: {
					toolbarLabel: 'INIT',
					requiresConfirmation: true,
					confirmationPrompt: 'Prepare the first Mission initialization worktree for this repository?'
				},
				presentationTargets: repositoryPresentationTargets,
				...(!input.control.initialized
					? { reason: 'Create the first mission worktree and scaffold repository control inside that branch-owned checkout.' }
					: {})
			},
			{
				id: 'control.setup.edit',
				label: 'Configure repository setup',
				action: '/setup',
				scope: 'mission',
				disabled: false,
				disabledReason: '',
				enabled: true,
				...(!input.control.settingsComplete ? { ordering: { group: 'recovery' as const } } : {}),
				ui: {
					toolbarLabel: 'SETTINGS',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: input.setupFlow
			},
			{
				id: 'control.mission.start',
				label: 'Prepare a new mission brief',
				action: '/start',
				scope: 'mission',
				disabled: false,
				disabledReason: '',
				enabled: true,
				ui: {
					toolbarLabel: 'PREPARE MISSION',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: input.missionStartFlow
			},
			{
				id: 'control.mission.select',
				label: 'Select a local mission',
				action: '/select',
				scope: 'mission',
				disabled: input.availableMissions.length === 0,
				disabledReason: input.availableMissions.length > 0 ? '' : 'No local missions are available.',
				enabled: input.availableMissions.length > 0,
				ui: {
					toolbarLabel: 'OPEN MISSION',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: input.missionSwitchFlow,
				...(input.availableMissions.length > 0 ? {} : { reason: 'No local missions are available.' })
			},
			{
				id: 'control.mission.from-issue',
				label: 'Prepare a mission from an open GitHub issue',
				action: '/issues',
				scope: 'mission',
				disabled: !issuesCommandEnabled,
				disabledReason: issuesCommandReason,
				enabled: issuesCommandEnabled,
				ui: {
					toolbarLabel: 'ISSUES',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: input.missionIssueFlow,
				...(issuesCommandEnabled ? {} : { reason: issuesCommandReason })
			}
		];
	}

	public buildControlActionRevision(control: RepositoryControlStatus): string {
		return JSON.stringify({
			scope: 'control',
			settingsPath: control.settingsPath,
			settingsComplete: control.settingsComplete,
			availableMissionCount: control.availableMissionCount,
			currentBranch: control.currentBranch ?? null,
			trackingProvider: control.trackingProvider ?? null
		});
	}

	public buildControlActionsSnapshot(input: {
		control: RepositoryControlStatus;
		actions: OperatorActionDescriptor[];
	}): OperatorActionListSnapshot {
		return {
			actions: input.actions,
			revision: this.buildControlActionRevision(input.control)
		};
	}

	public async buildRepositoryDiscoveryStatus(
		availableMissions: MissionSelectionCandidate[],
		availableRepositories: ControlSource['availableRepositories'] = []
	): Promise<OperatorStatus> {
		const startedAt = performance.now();
		const controlStartedAt = performance.now();
		const control = await this.buildControlPlaneStatus(availableMissions.length);
		const controlDurationMs = performance.now() - controlStartedAt;
		const totalDurationMs = performance.now() - startedAt;
		process.stdout.write(
			`${new Date().toISOString().slice(11, 19)} repository.buildDiscoveryStatus total=${totalDurationMs.toFixed(1)}ms buildControl=${controlDurationMs.toFixed(1)}ms missions=${String(availableMissions.length)} repositories=${String(availableRepositories.length)}\n`
		);

		return this.buildDiscoveryStatus({
			control,
			availableRepositories,
			availableMissions
		});
	}

	public async readControlSource(input: {
		availableRepositories?: ControlSource['availableRepositories'];
		selectedMissionId?: string;
		missionStatusHint?: OperatorStatus;
	} = {}): Promise<ControlSource> {
		const host = this.requireWorkspaceHost();
		const availableMissions = await this.listMissionSelectionCandidates();
		const discoveryStatus = await this.buildRepositoryDiscoveryStatus(availableMissions, input.availableRepositories ?? []);
		const selectedMissionId = input.selectedMissionId?.trim();
		const hintedMissionStatus = input.missionStatusHint?.missionId?.trim()
			&& input.missionStatusHint.missionId.trim() === selectedMissionId
			? input.missionStatusHint
			: undefined;
		const missionStatus = hintedMissionStatus
			?? (selectedMissionId
				? await host.resolveLoadedMissionStatus(selectedMissionId).catch(() => undefined)
				: undefined);
		return this.buildControlSource({
			control: discoveryStatus.control!,
			...(input.availableRepositories ? { availableRepositories: input.availableRepositories } : {}),
			availableMissions,
			...(missionStatus ? { missionStatus } : {})
		});
	}

	public async executeControlAction(params: ControlActionExecute): Promise<OperatorStatus> {
		const host = this.requireWorkspaceHost();
		if (params.actionId === 'control.repository.init') {
			return this.createRepositoryInitializationMission();
		}

		if (params.actionId === 'control.setup.edit') {
			const fieldSelection = requireSingleSelectionActionStep(params.steps ?? [], 'field');
			const field = asControlSettingField(fieldSelection.optionIds[0]);
			if (!field) {
				throw new Error('Mission setup requires a valid settings field selection.');
			}
			const value = requireSingleValueActionStep(params.steps ?? [], 'value');
			await this.writeControlSetting(field, value);
			return this.buildIdleMissionStatus();
		}

		if (params.actionId === 'control.mission.start') {
			const typeSelection = requireSingleSelectionActionStep(params.steps ?? [], 'type');
			const missionType = asMissionType(typeSelection.optionIds[0]);
			if (!missionType) {
				throw new Error('Mission start requires a valid mission type selection.');
			}
			const title = requireTextActionStep(params.steps ?? [], 'title').value.trim();
			const body = requireTextActionStep(params.steps ?? [], 'body').value.trim();
			if (!title || !body) {
				throw new Error('Mission start requires both a title and body.');
			}
			return this.createMissionFromBrief({ brief: { title, body, type: missionType } });
		}

		if (params.actionId === 'control.mission.select') {
			const missionSelection = requireSingleSelectionActionStep(params.steps ?? [], 'mission');
			const missionId = missionSelection.optionIds[0]?.trim();
			if (!missionId) {
				throw new Error('Mission selection requires a mission id.');
			}
			return host.resolveMissionOperatorStatus({ selector: { missionId } });
		}

		if (params.actionId === 'control.mission.from-issue') {
			const issueSelection = requireSingleSelectionActionStep(params.steps ?? [], 'issue');
			const issueNumber = Number.parseInt(issueSelection.optionIds[0] ?? '', 10);
			if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
				throw new Error('Issue selection requires a valid issue number.');
			}
			return this.createMissionFromIssue({ issueNumber });
		}

		throw new Error(`Unsupported control action '${params.actionId}'.`);
	}

	public async listControlActions(params: ControlActionList = {}): Promise<OperatorActionListSnapshot> {
		const availableMissions = await this.listMissionSelectionCandidates();
		const control = await this.buildControlPlaneStatus(availableMissions.length);
		let openIssues: TrackedIssueSummary[] = [];
		if (control.trackingProvider === 'github' && control.issuesConfigured) {
			try {
				openIssues = await this.listOpenIssues(100);
			} catch {
				openIssues = [];
			}
		}
		const snapshot = this.buildControlActionsSnapshot({
			control,
			actions: this.resolveAvailableActions(this.buildRepositoryDiscoveryAvailableActions(control, availableMissions, openIssues), params.context)
		});
		this.replaceAvailableActionsSnapshot(snapshot);
		return snapshot;
	}

	public async createMissionFromBrief(params: MissionFromBriefRequest, request?: Request): Promise<OperatorStatus> {
		const authToken = this.readRequestAuthToken(request);
		const reconciledBrief = params.brief.issueId !== undefined
			? params.brief
			: await this.createMissionIssueBrief({
				title: params.brief.title,
				body: params.brief.body
			}, authToken).then((createdIssue) => ({
				...params.brief,
				...(createdIssue.issueId !== undefined ? { issueId: createdIssue.issueId } : {}),
				...(createdIssue.url ? { url: createdIssue.url } : {}),
				...(createdIssue.labels ? { labels: createdIssue.labels } : {})
			}));
		if (reconciledBrief.issueId === undefined) {
			throw new Error('Mission preparation requires a reconciled GitHub issue number.');
		}

		return this.prepareMissionFromResolvedBrief(reconciledBrief, params.branchRef);
	}

	public async createRepositoryInitializationMission(): Promise<OperatorStatus> {
		if (await this.isRepositoryInitialized()) {
			throw new Error('This checkout already contains Mission control scaffolding.');
		}

		return this.prepareMissionFromResolvedBrief({
			title: 'Initialize Mission repository scaffolding',
			body: [
				'Prepare this repository for Mission inside the first initialization mission worktree.',
				'',
				'Scaffold repository control under .mission/, including the unified workflow.json settings document and the repository-owned workflow preset under .mission/workflow/.',
				'Keep the work reviewable on the mission branch and do not mutate the original checkout directly outside this mission flow.',
				'When ready, commit the scaffold on this branch so it can be reviewed and merged back into the repository.'
			].join('\n'),
			type: 'task'
		});
	}

	public async updateControlSettings(params: ControlSettingsUpdate): Promise<OperatorStatus> {
		await this.writeControlSetting(params.field, params.value);
		return this.buildIdleMissionStatus();
	}

	public async createMissionFromIssue(
		params: MissionFromIssueRequest,
		request?: Request
	): Promise<OperatorStatus> {
		const authToken = this.readRequestAuthToken(request);
		const brief = await this.fetchMissionIssueBrief(params.issueNumber, authToken);
		return this.prepareMissionFromResolvedBrief(brief);
	}

	public async describeControlAction(
		params: ControlActionDescribe
	): Promise<OperatorActionFlowDescriptor> {
		const control = await this.buildControlPlaneStatus();
		if (params.actionId === 'control.repository.init') {
			throw new Error('Repository initialization does not have a multi-step flow. Execute /init directly.');
		}
		if (params.actionId === 'control.setup.edit') {
			return this.buildSetupCommandFlow(control, params.steps ?? []);
		}
		if (params.actionId === 'control.mission.start') {
			return this.buildMissionStartFlow();
		}
		if (params.actionId === 'control.mission.select') {
			return this.buildMissionSwitchFlow(await this.listMissionSelectionCandidates());
		}
		if (params.actionId === 'control.mission.from-issue') {
			return this.buildMissionIssueFlow(await this.listOpenIssues(100));
		}
		throw new Error(`Unsupported control action '${params.actionId}'.`);
	}

	public override toStateSnapshot(): RepositoryStateSnapshot {
		const repository = this.toSnapshot();
		const availableCommands = this.listAvailableActionsSnapshot();
		return {
			data: repository,
			repository,
			...(availableCommands ? { commands: availableCommands, availableCommands } : {})
		};
	}

	protected invalidateMissionSelectionCache(): void {
		this.missionSelectionCache = undefined;
	}

	protected async prepareMissionFromResolvedBrief(
		reconciledBrief: MissionBrief,
		branchRefOverride?: string
	): Promise<OperatorStatus> {
		const host = this.requireWorkspaceHost();
		const existingMission = await host.store.resolveTrackedMission({
			...(reconciledBrief.issueId !== undefined ? { issueId: reconciledBrief.issueId } : {}),
			...(branchRefOverride ? { branchRef: branchRefOverride } : {})
		});
		if (existingMission) {
			const status = await host.resolveMissionOperatorStatus({
				selector: { missionId: existingMission.descriptor.missionId }
			});
			return {
				...status,
				missionId: existingMission.descriptor.missionId,
				title: existingMission.descriptor.brief.title,
				...(existingMission.descriptor.brief.issueId !== undefined
					? { issueId: existingMission.descriptor.brief.issueId }
					: {}),
				branchRef: existingMission.descriptor.branchRef,
				missionRootDir: existingMission.missionDir,
				recommendedAction: reconciledBrief.issueId !== undefined
					? `Issue #${String(reconciledBrief.issueId)} already has mission '${existingMission.descriptor.missionId}'. Pull the default branch if needed and select the existing mission instead of creating another work-on-issue mission.`
					: `Mission '${existingMission.descriptor.missionId}' already exists. Select the existing mission instead of creating another one.`
			};
		}

		const branchRef =
			branchRefOverride
			?? (reconciledBrief.issueId !== undefined
				? host.store.deriveMissionBranchName(reconciledBrief.issueId, reconciledBrief.title)
				: host.store.deriveDraftMissionBranchName(reconciledBrief.title));
		const preparation = await new MissionPreparationService(
			host.store,
			host.buildWorkflowBindings()
		).prepareFromBrief({
			brief: reconciledBrief,
			branchRef: branchRefOverride ?? branchRef
		});
		if (preparation.kind !== 'mission') {
			throw new Error('Mission preparation returned an unexpected non-mission result.');
		}

		this.invalidateMissionSelectionCache();

		const selectedStatus = await host.resolveMissionOperatorStatus({
			selector: { missionId: preparation.missionId }
		});
		return {
			...selectedStatus,
			missionId: preparation.missionId,
			title: reconciledBrief.title,
			...(reconciledBrief.issueId !== undefined ? { issueId: reconciledBrief.issueId } : {}),
			type: reconciledBrief.type,
			branchRef: preparation.branchRef,
			missionRootDir: preparation.missionRootDir,
			preparation
		};
	}

	protected async buildIdleMissionStatus(): Promise<OperatorStatus> {
		return this.buildRepositoryDiscoveryStatus(await this.listMissionSelectionCandidates());
	}

	protected buildRepositoryDiscoveryAvailableActions(
		control: RepositoryControlStatus,
		availableMissions: MissionSelectionCandidate[],
		openIssues: TrackedIssueSummary[]
	): OperatorActionDescriptor[] {
		return this.buildDiscoveryAvailableActions({
			control,
			availableMissions,
			openIssues,
			setupFlow: this.buildSetupCommandFlow(control),
			missionStartFlow: this.buildMissionStartFlow(),
			missionSwitchFlow: this.buildMissionSwitchFlow(availableMissions),
			missionIssueFlow: this.buildMissionIssueFlow(openIssues)
		});
	}

	protected async buildControlPlaneStatus(
		availableMissionCount?: number
	): Promise<RepositoryControlStatus> {
		const host = this.requireWorkspaceHost();
		const settings = readWorkflowSettingsDocument(this.repositoryRootPath);
		const effectiveSettings = settings ?? createDefaultRepositoryWorkflowSettingsDocument();
		const githubRepository = effectiveSettings.integration.trackingProvider === 'github'
			? resolveGitHubRepositoryFromWorkspace(this.repositoryRootPath)
			: undefined;
		const issuesConfigured = effectiveSettings.integration.trackingProvider === 'github' && Boolean(githubRepository);
		const problems: string[] = [];
		const warnings: string[] = [];
		const isGitRepository = host.store.isGitRepository();
		const initialized = await this.isRepositoryInitialized();
		if (!isGitRepository) {
			problems.push('Mission requires a Git repository.');
		}
		if (!initialized || !settings) {
			warnings.push('Mission control will be created in the first mission worktree if it is not already present on this checkout.');
		}
		if (!effectiveSettings.runtime.agentRunner) {
			problems.push('Mission control agent runner is not configured.');
		}
		if (!effectiveSettings.runtime.defaultAgentMode) {
			problems.push('Mission control default agent mode is not configured.');
		}
		if (!effectiveSettings.runtime.defaultModel) {
			problems.push('Mission control default model is not configured.');
		}
		if (effectiveSettings.integration.trackingProvider === 'github' && !githubRepository) {
			warnings.push('Mission could not resolve a GitHub repository from the current workspace.');
		}

		return {
			controlRoot: this.repositoryRootPath,
			missionDirectory: getMissionDirectoryPath(this.repositoryRootPath),
			settingsPath: getWorkflowSettingsDocumentPath(this.repositoryRootPath),
			worktreesPath: getMissionWorktreesPath(
				this.repositoryRootPath,
				effectiveSettings.paths.missionWorkspaceRoot
					? { missionWorkspaceRoot: effectiveSettings.paths.missionWorkspaceRoot }
					: {}
			),
			...(isGitRepository ? { currentBranch: host.store.getCurrentBranch() } : {}),
			settings: effectiveSettings,
			isGitRepository,
			initialized,
			settingsPresent: settings !== undefined,
			settingsComplete: problems.length === 0,
			...(effectiveSettings.integration.trackingProvider ? { trackingProvider: effectiveSettings.integration.trackingProvider } : {}),
			...(githubRepository ? { githubRepository } : {}),
			issuesConfigured,
			availableMissionCount:
				availableMissionCount ?? (await host.store.listMissions()).length,
			problems,
			warnings
		};
	}

	protected resolveOperationalMode(control: RepositoryControlStatus): Extract<MissionOperationalMode, 'setup' | 'root'> {
		return control.problems.length > 0 ? 'setup' : 'root';
	}

	protected async isRepositoryInitialized(): Promise<boolean> {
		try {
			await Promise.all([
				fs.access(getMissionDirectoryPath(this.repositoryRootPath)),
				fs.access(getWorkflowSettingsDocumentPath(this.repositoryRootPath)),
				fs.access(getMissionWorkflowDefinitionPath(this.repositoryRootPath))
			]);
			return true;
		} catch {
			return false;
		}
	}

	protected buildSetupCommandFlow(
		control: RepositoryControlStatus,
		steps: OperatorActionExecutionStep[] = []
	): OperatorActionFlowDescriptor {
		const selectedField = readSingleSelectionStep(steps, 'field') as ControlSettingsUpdate['field'] | undefined;
		return {
			targetLabel: 'SETUP',
			actionLabel: 'SAVE',
			steps: [
				{
					kind: 'selection',
					id: 'field',
					label: 'SETTING',
					title: 'SETUP',
					emptyLabel: 'No setup fields are available.',
					helperText: 'Choose the setting you want to update.',
					selectionMode: 'single',
					options: this.buildSetupCommandFlowOptions(control)
				},
				this.buildSetupValueStep(control, selectedField)
			]
		};
	}

	protected buildSetupCommandFlowOptions(
		control: RepositoryControlStatus
	): OperatorActionFlowOption[] {
		return [
			{
				id: 'agentRunner',
				label: 'Agent Runner',
				description: control.settings.runtime.agentRunner.trim() || 'Required'
			},
			{
				id: 'defaultAgentMode',
				label: 'Default Agent Mode',
				description: control.settings.runtime.defaultAgentMode?.trim() || 'Required'
			},
			{
				id: 'defaultModel',
				label: 'Default Model',
				description: control.settings.runtime.defaultModel?.trim() || 'Required'
			},
			{
				id: 'towerTheme',
				label: 'Tower Theme',
				description: control.settings.runtime.towerTheme?.trim() || 'ocean'
			},
			{
				id: 'missionWorkspaceRoot',
				label: 'Mission Workspace Root',
				description: control.settings.paths.missionWorkspaceRoot.trim() || 'missions'
			},
			{
				id: 'instructionsPath',
				label: 'Instructions Path',
				description: control.settings.paths.instructionsPath.trim() || '.agents'
			},
			{
				id: 'skillsPath',
				label: 'Skills Path',
				description: control.settings.paths.skillsPath.trim() || '.agents/skills'
			}
		];
	}

	protected buildSetupValueStep(
		control: RepositoryControlStatus,
		selectedField: ControlSettingsUpdate['field'] | undefined
	): OperatorActionFlowDescriptor['steps'][number] {
		if (selectedField === 'agentRunner') {
			return {
				kind: 'selection',
				id: 'value',
				label: 'VALUE',
				title: 'RUNNER',
				emptyLabel: 'No runners are available.',
				helperText: 'Choose the runner Mission should use.',
				selectionMode: 'single',
				options: this.orderSelectedOptionFirst([
					{
						id: 'copilot-cli',
						label: 'Copilot CLI',
						description: 'Interactive Copilot CLI session in daemon-backed PTY transport'
					},
					{
						id: 'pi',
						label: 'Copilot SDK',
						description: 'Headless Copilot SDK process with no UI'
					}
				], control.settings.runtime.agentRunner)
			};
		}
		if (selectedField === 'defaultAgentMode') {
			const configuredRunnerId = control.settings.runtime.agentRunner?.trim();
			const usesTerminalTransport = configuredRunnerId === 'copilot-cli';
			return {
				kind: 'selection',
				id: 'value',
				label: 'VALUE',
				title: 'DEFAULT MODE',
				emptyLabel: 'No agent modes are available.',
				helperText: 'Choose how the configured runner should run by default.',
				selectionMode: 'single',
				options: this.orderSelectedOptionFirst([
					{
						id: 'interactive',
						label: 'Interactive',
						description: usesTerminalTransport
							? 'Operator-guided terminal session'
							: 'Operator-guided runtime session'
					},
					{
						id: 'autonomous',
						label: 'Autonomous',
						description: usesTerminalTransport
							? 'PTY transport continues until interrupted or complete'
							: 'Runtime continues with autonomous execution'
					}
				], control.settings.runtime.defaultAgentMode)
			};
		}
		if (selectedField === 'towerTheme') {
			return {
				kind: 'selection',
				id: 'value',
				label: 'VALUE',
				title: 'THEME',
				emptyLabel: 'No tower themes are available.',
				helperText: 'Choose the tower theme.',
				selectionMode: 'single',
				options: this.orderSelectedOptionFirst([
					{ id: 'ocean', label: 'OCEAN', description: 'Deep blue tower theme' },
					{ id: 'sand', label: 'SAND', description: 'Warm neutral tower theme' }
				], control.settings.runtime.towerTheme)
			};
		}

		return {
			kind: 'text',
			id: 'value',
			label: 'VALUE',
			title: selectedField === 'defaultModel' ? 'MODEL' : 'SETTING VALUE',
			helperText: selectedField === 'defaultModel'
				? 'Enter the default model id for the selected runner.'
				: 'Enter the new value for the selected setting.',
			placeholder: selectedField === 'defaultModel' ? 'Enter the model id' : 'Enter the updated value',
			initialValue: this.resolveSetupTextInitialValue(control, selectedField),
			inputMode: 'compact',
			format: 'plain'
		};
	}

	protected resolveSetupTextInitialValue(
		control: RepositoryControlStatus,
		selectedField: ControlSettingsUpdate['field'] | undefined
	): string {
		if (selectedField === 'instructionsPath') {
			return control.settings.paths.instructionsPath ?? '';
		}
		if (selectedField === 'skillsPath') {
			return control.settings.paths.skillsPath ?? '';
		}
		if (selectedField === 'defaultModel') {
			return control.settings.runtime.defaultModel ?? '';
		}
		if (selectedField === 'missionWorkspaceRoot') {
			return control.settings.paths.missionWorkspaceRoot ?? '';
		}
		return '';
	}

	protected orderSelectedOptionFirst(
		options: OperatorActionFlowOption[],
		selectedId: string | undefined
	): OperatorActionFlowOption[] {
		if (!selectedId) {
			return options;
		}
		const selectedOption = options.find((option) => option.id === selectedId);
		if (!selectedOption) {
			return options;
		}
		return [selectedOption, ...options.filter((option) => option.id !== selectedId)];
	}

	protected buildMissionStartFlow(): OperatorActionFlowDescriptor {
		return {
			targetLabel: 'MISSION',
			actionLabel: 'PREPARE',
			steps: [
				{
					kind: 'selection',
					id: 'type',
					label: 'TYPE',
					title: 'MISSION TYPE',
					emptyLabel: 'No mission types are available.',
					helperText: 'Choose the primary mission type.',
					selectionMode: 'single',
					options: this.buildMissionTypeOptions()
				},
				{
					kind: 'text',
					id: 'title',
					label: 'TITLE',
					title: 'MISSION TITLE',
					helperText: 'Enter a short mission title. Mission will create the GitHub issue first, then materialize the mission branch and local worktree.',
					placeholder: 'Summarize the mission to prepare',
					inputMode: 'compact',
					format: 'plain'
				},
				{
					kind: 'text',
					id: 'body',
					label: 'BODY',
					title: 'MISSION BODY',
					helperText: 'Describe the mission in Markdown. This content seeds the GitHub issue first, then the mission branch and tracked brief inside the local mission worktree. Enter submits, Shift+Enter adds a newline, and Ctrl+P or Tab toggles preview.',
					placeholder: 'Describe the mission scope, constraints, and expected outcome for the mission branch.',
					inputMode: 'expanded',
					format: 'markdown'
				}
			]
		};
	}

	protected buildMissionTypeOptions(): OperatorActionFlowOption[] {
		return [
			{
				id: 'feature',
				label: 'Feature',
				description: 'Add or extend product behavior.'
			},
			{
				id: 'fix',
				label: 'Fix',
				description: 'Correct broken or incorrect behavior.'
			},
			{
				id: 'docs',
				label: 'Docs',
				description: 'Improve or create documentation.'
			},
			{
				id: 'refactor',
				label: 'Refactor',
				description: 'Reshape internals without changing intent.'
			},
			{
				id: 'task',
				label: 'Task',
				description: 'Operational or maintenance work.'
			}
		];
	}

	protected buildMissionSwitchFlow(
		availableMissions: MissionSelectionCandidate[]
	): OperatorActionFlowDescriptor {
		const host = this.requireWorkspaceHost();
		return {
			targetLabel: 'MISSION',
			actionLabel: 'SWITCH',
			steps: [
				{
					kind: 'selection',
					id: 'mission',
					label: 'MISSION',
					title: 'SELECT MISSION',
					emptyLabel: `No local missions are available under ${host.store.getMissionsPath()}.`,
					helperText: 'Choose the local mission worktree you want to open.',
					selectionMode: 'single',
					options: availableMissions.map((candidate) => ({
						id: candidate.missionId,
						label: candidate.title,
						description: `${candidate.missionId} | ${candidate.branchRef}`
					}))
				}
			]
		};
	}

	protected buildMissionIssueFlow(
		openIssues: TrackedIssueSummary[]
	): OperatorActionFlowDescriptor {
		return {
			targetLabel: 'MISSION',
			actionLabel: 'FROM ISSUE',
			steps: [
				{
					kind: 'selection',
					id: 'issue',
					label: 'ISSUE',
					title: 'SELECT ISSUE',
					emptyLabel: 'No open GitHub issues are available.',
					helperText: 'Choose the open GitHub issue to materialize as a mission.',
					selectionMode: 'single',
					options: openIssues.map((issue) => ({
						id: String(issue.number),
						label: `#${String(issue.number)} ${issue.title}`,
						description: issue.labels.length > 0 ? issue.labels.join(', ') : issue.url
					}))
				}
			]
		};
	}

	protected async writeControlSetting(
		field: ControlSettingsUpdate['field'],
		rawValue: string
	): Promise<void> {
		if (!(await this.isRepositoryInitialized())) {
			throw new Error(
				'Repository settings cannot be edited locally until the initialization mission scaffold is merged and pulled into this checkout.'
			);
		}

		const nextSettings: WorkflowSettingsDocument = resolveWorkflowSettingsDocument(
			readWorkflowSettingsDocument(this.repositoryRootPath) ?? {}
		);
		const value = rawValue.trim();

		switch (field) {
			case 'agentRunner':
				if (value !== 'copilot-cli' && value !== 'pi') {
					throw new Error(`Unsupported Mission agent runner '${value}'.`);
				}
				nextSettings.runtime.agentRunner = value;
				break;
			case 'defaultAgentMode':
				if (value.length === 0) {
					delete nextSettings.runtime.defaultAgentMode;
					break;
				}
				if (value !== 'interactive' && value !== 'autonomous') {
					throw new Error(`Unsupported Mission default agent mode '${value}'.`);
				}
				nextSettings.runtime.defaultAgentMode = value;
				break;
			case 'defaultModel':
				if (value.length === 0) {
					delete nextSettings.runtime.defaultModel;
					break;
				}
				nextSettings.runtime.defaultModel = value;
				break;
			case 'towerTheme':
				if (value.length === 0) {
					delete nextSettings.runtime.towerTheme;
					break;
				}
				nextSettings.runtime.towerTheme = value;
				break;
			case 'missionWorkspaceRoot':
				nextSettings.paths.missionWorkspaceRoot = value.length === 0 ? 'missions' : value;
				break;
			case 'instructionsPath':
				nextSettings.paths.instructionsPath = value.length === 0 ? '.agents' : value;
				break;
			case 'skillsPath':
				nextSettings.paths.skillsPath = value.length === 0 ? '.agents/skills' : value;
				break;
			default:
				throw new Error(`Unsupported Mission setting '${field}'.`);
		}

		await writeWorkflowSettingsDocument(nextSettings, this.repositoryRootPath);
	}

	private resolvePlatformAdapter(
		authToken?: string,
		options: {
			requireRepository?: boolean;
		} = {}
	): RepositoryPlatformAdapter | undefined {
		const settings = readWorkflowSettingsDocument(this.repositoryRootPath) ?? createDefaultRepositoryWorkflowSettingsDocument();
		if (settings.integration.trackingProvider !== 'github') {
			return undefined;
		}

		const githubRepository = resolveGitHubRepositoryFromWorkspace(this.repositoryRootPath);
		if (options.requireRepository && !githubRepository) {
			throw new Error('Mission could not resolve a GitHub repository from the current workspace.');
		}

		const normalizedToken = this.normalizeAuthToken(authToken);
		return new GitHubPlatformAdapter(
			this.repositoryRootPath,
			githubRepository,
			normalizedToken ? { authToken: normalizedToken } : {}
		) as RepositoryPlatformAdapter;
	}

	private requireGitHubAuthentication(authToken?: string): void {
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

	private requireWorkspaceHost(): RepositoryWorkspaceHost {
		if (!this.workspaceHost) {
			throw new Error(`Repository '${this.repositoryId}' requires a workspace host for daemon-side control operations.`);
		}

		return this.workspaceHost;
	}

	protected resolveAvailableActions(
		actions: OperatorActionDescriptor[],
		context?: OperatorActionQueryContext
	): OperatorActionDescriptor[] {
		if (!context) {
			return orderAvailableActions(actions)
				.map((action) => structuredClone(action));
		}
		return resolveAvailableActionsForTargetContext(actions, context)
			.map((action) => structuredClone(action));
	}

	protected readRequestAuthToken(request?: Request): string | undefined {
		const authToken = request?.authToken?.trim();
		return authToken && authToken.length > 0 ? authToken : undefined;
	}
}

export type {
	MissionReference,
	RepositoryData as RepositorySummary,
	RepositoryStateSnapshot
};

function readSingleSelectionStep(
	steps: OperatorActionExecutionStep[],
	stepId: string
): string | undefined {
	const step = steps.find(
		(candidate): candidate is OperatorActionExecutionSelectionStep =>
			candidate.kind === 'selection' && candidate.stepId === stepId
	);
	if (step?.optionIds.length !== 1) {
		return undefined;
	}
	const optionId = step.optionIds[0]?.trim();
	return optionId && optionId.length > 0 ? optionId : undefined;
}

function requireSingleSelectionActionStep(
	steps: OperatorActionExecutionStep[],
	stepId: string
): OperatorActionExecutionSelectionStep {
	const step = steps.find(
		(candidate): candidate is OperatorActionExecutionSelectionStep =>
			candidate.kind === 'selection' && candidate.stepId === stepId
	);
	if (!step) {
		throw new Error(`Mission action requires selection step '${stepId}'.`);
	}
	if (step.optionIds.length !== 1 || !step.optionIds[0]?.trim()) {
		throw new Error(`Mission action requires a single selection for step '${stepId}'.`);
	}
	return step;
}

function requireTextActionStep(
	steps: OperatorActionExecutionStep[],
	stepId: string
): OperatorActionExecutionTextStep {
	const step = steps.find(
		(candidate): candidate is OperatorActionExecutionTextStep =>
			candidate.kind === 'text' && candidate.stepId === stepId
	);
	if (!step) {
		throw new Error(`Mission action requires text step '${stepId}'.`);
	}
	return step;
}

function requireSingleValueActionStep(
	steps: OperatorActionExecutionStep[],
	stepId: string
): string {
	const step = steps.find((candidate) => candidate.stepId === stepId);
	if (!step) {
		throw new Error(`Mission action requires value step '${stepId}'.`);
	}
	if (step.kind === 'text') {
		return step.value;
	}
	if (step.optionIds.length !== 1 || !step.optionIds[0]?.trim()) {
		throw new Error(`Mission action requires a single value for step '${stepId}'.`);
	}
	return step.optionIds[0];
}

function asControlSettingField(
	value: string | undefined
): ControlSettingsUpdate['field'] | undefined {
	if (
		value === 'agentRunner'
		|| value === 'defaultAgentMode'
		|| value === 'defaultModel'
		|| value === 'towerTheme'
		|| value === 'missionWorkspaceRoot'
		|| value === 'instructionsPath'
		|| value === 'skillsPath'
	) {
		return value;
	}
	return undefined;
}

function asMissionType(value: string | undefined): MissionFromBriefRequest['brief']['type'] | undefined {
	if (
		value === 'feature'
		|| value === 'fix'
		|| value === 'docs'
		|| value === 'refactor'
		|| value === 'task'
	) {
		return value;
	}
	return undefined;
}