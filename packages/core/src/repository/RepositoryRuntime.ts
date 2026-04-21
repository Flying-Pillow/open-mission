import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MissionPreparationService } from '../mission/MissionPreparationService.js';
import { Mission } from '../mission/Mission.js';
import { Factory } from '../mission/Factory.js';
import { buildMissionTaskLaunchPrompt } from '../mission/taskLaunchPrompt.js';
import type { MissionWorkflowBindings } from '../mission/Mission.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { orderAvailableActions, resolveAvailableActionsForTargetContext } from '../lib/operatorActionTargeting.js';
import {
	getDefaultMissionDaemonSettingsWithOverrides,
	getMissionDaemonSettingsPath,
	readMissionDaemonSettings,
	type MissionDaemonSettings,
	writeMissionDaemonSettings
} from '../lib/daemonConfig.js';
import {
	getMissionGitHubCliBinary,
	listRegisteredUserRepositories,
	registerMissionUserRepo
} from '../lib/userConfig.js';
import {
	GitHubPlatformAdapter,
	type GitHubBranchSyncStatus,
	resolveGitHubRepositoryFromWorkspace
} from '../platforms/GitHubPlatformAdapter.js';
import {
	type MissionAgentDisposable
} from '../agent/events.js';
import {
	TerminalAgentTransport,
	type TerminalSessionSnapshot
} from '../agent/TerminalAgentTransport.js';
import {
	getMissionDirectoryPath,
	getMissionWorkflowDefinitionPath,
	getMissionWorktreesPath,
} from '../lib/repoConfig.js';
import {
	deriveRepositoryIdentity,
	slugRepositoryIdentitySegment
} from '../lib/repositoryIdentity.js';
import { resolveMissionWorkspaceContext } from '../lib/workspacePaths.js';
import type {
	MissionBrief,
	OperatorActionExecutionStep,
	OperatorActionExecutionSelectionStep,
	OperatorActionExecutionTextStep,
	OperatorActionDescriptor,
	OperatorActionListSnapshot,
	OperatorActionFlowDescriptor,
	OperatorActionFlowOption,
	OperatorActionQueryContext,
	RepositoryControlStatus,
	MissionOperationalMode,
	MissionSelectionCandidate,
	MissionStageId,
	MissionTaskState,
	MissionSelector,
	TrackedIssueSummary,
	OperatorStatus
} from '../types.js';
import type { ControlSource } from '../daemon/control-plane/types.js';
import {
	type ControlActionList,
	type ControlActionDescribe,
	type ControlActionExecute,
	type ControlDocumentRead,
	type ControlDocumentResponse,
	type ControlDocumentWrite,
	type ControlIssuesList,
	type MissionFromBriefRequest,
	type MissionFromIssueRequest,
	type ControlSettingsUpdate,
	type ControlWorkflowSettingsInitialize,
	type ControlWorkflowSettingsInitializeResponse,
	type ControlWorkflowSettingsUpdate,
	type ControlWorkflowSettingsUpdateResponse,
	type MissionActionExecute,
	type MissionActionList,
	type MissionGateEvaluate,
	type MissionAgentConsoleState,
	type MissionAgentTerminalState,
	type MissionAgentEvent,
	type MissionAgentSessionRecord,
	type MissionTerminalInput,
	type MissionTerminalStateRequest,
	type MissionSelect,
	type Notification,
	type Request,
	type SessionCommand,
	type SessionComplete,
	type SessionConsoleState,
	type SessionControl,
	type SessionTerminalInput,
	type SessionTerminalState,
	type SessionPrompt
} from '../daemon/protocol/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../agent/AgentRuntimeTypes.js';
import type { AgentRunner } from '../agent/AgentRunner.js';
import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';
import { refreshSystemStatus } from '../system/SystemStatus.js';
import {
	WorkflowSettingsStore,
	type WorkflowSettingsGetResult
} from '../settings/index.js';

type LoadedMission = {
	missionId: string;
	branchRef: string;
	mission: Mission;
	commandState: LoadedMissionCommandState;
	consoleSubscription: MissionAgentDisposable;
	eventSubscription: MissionAgentDisposable;
	autopilotEnabled: boolean;
	autopilotQueue: Promise<void>;
};

type LoadedMissionCommandState = {
	repositorySync?: RepositorySyncState;
};

type RepositorySyncState = {
	provider: 'github';
	status: GitHubBranchSyncStatus['status'] | 'unsupported' | 'error';
	branchRef: string;
	checkedAt: string;
	revision: string;
	worktreeClean?: boolean;
	reason?: string;
	trackingRef?: string;
	aheadCount?: number;
	behindCount?: number;
	localHead?: string;
	remoteHead?: string;
};

type RepositoryCommandContext = {
	loadedMission: LoadedMission;
	missionStatus: OperatorStatus;
	currentStageId?: MissionStageId;
	repositorySync?: RepositorySyncState;
};

type RepositoryCommandRuleResult = {
	enabled: boolean;
	reason?: string;
};

type RepositoryCommandDefinition = {
	id: string;
	label: string;
	action: string;
	ordering?: OperatorActionDescriptor['ordering'];
	ui: NonNullable<OperatorActionDescriptor['ui']>;
	evaluate: (context: RepositoryCommandContext) => RepositoryCommandRuleResult;
	buildFlow?: (
		repository: RepositoryRuntime,
		context: RepositoryCommandContext
	) => Promise<OperatorActionFlowDescriptor>;
};

type PendingTerminalNotification = {
	loadedMission: LoadedMission;
	event: TerminalSessionSnapshot;
	timer: ReturnType<typeof setTimeout>;
};

const TERMINAL_EVENT_BATCH_WINDOW_MS = 50;

export class RepositoryRuntime {
	private readonly store: FilesystemAdapter;
	private readonly workflowSettingsStore: WorkflowSettingsStore;
	private readonly agentRunners = new Map<string, AgentRunner>();
	private readonly loadedMissions = new Map<string, LoadedMission>();
	private readonly terminalTransport = new TerminalAgentTransport();
	private readonly terminalSubscription: MissionAgentDisposable;
	private readonly pendingTerminalNotifications = new Map<string, PendingTerminalNotification>();

	public constructor(
		private readonly repositoryRoot: string,
		agentRunners: Map<string, AgentRunner>,
		private readonly emitEvent: (event: Notification) => void
	) {
		this.store = new FilesystemAdapter(repositoryRoot);
		this.workflowSettingsStore = new WorkflowSettingsStore(repositoryRoot);
		for (const [runnerId, runner] of agentRunners) {
			this.agentRunners.set(runnerId, runner);
		}
		this.terminalSubscription = TerminalAgentTransport.onDidSessionUpdate((event) => {
			const loadedMission = this.findLoadedMissionForSession(event.sessionName);
			if (!loadedMission) {
				return;
			}
			this.queueTerminalEvent(loadedMission, event);
		});
	}

	private queueTerminalEvent(
		loadedMission: LoadedMission,
		event: TerminalSessionSnapshot
	): void {
		const key = this.createTerminalNotificationKey(loadedMission.missionId, event.sessionName);
		const existing = this.pendingTerminalNotifications.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			const mergedEvent: TerminalSessionSnapshot = {
				...event,
				chunk: `${existing.event.chunk ?? ''}${event.chunk ?? ''}`,
				screen: event.screen,
				truncated: existing.event.truncated || event.truncated
			};
			if (this.shouldFlushTerminalEventImmediately(mergedEvent)) {
				this.pendingTerminalNotifications.delete(key);
				this.emitTerminalEvent(loadedMission, mergedEvent);
				return;
			}
			this.pendingTerminalNotifications.set(key, {
				loadedMission,
				event: mergedEvent,
				timer: setTimeout(() => {
					this.flushTerminalEvent(key);
				}, TERMINAL_EVENT_BATCH_WINDOW_MS)
			});
			return;
		}

		if (this.shouldFlushTerminalEventImmediately(event)) {
			this.emitTerminalEvent(loadedMission, event);
			return;
		}

		this.pendingTerminalNotifications.set(key, {
			loadedMission,
			event,
			timer: setTimeout(() => {
				this.flushTerminalEvent(key);
			}, TERMINAL_EVENT_BATCH_WINDOW_MS)
		});
	}

	private flushTerminalEvent(key: string): void {
		const pending = this.pendingTerminalNotifications.get(key);
		if (!pending) {
			return;
		}
		this.pendingTerminalNotifications.delete(key);
		this.emitTerminalEvent(pending.loadedMission, pending.event);
	}

	private emitTerminalEvent(
		loadedMission: LoadedMission,
		event: TerminalSessionSnapshot
	): void {
		const sessionId = this.resolveTerminalEventSessionId(loadedMission, event.sessionName);
		this.emitEvent({
			type: 'session.terminal',
			missionId: loadedMission.missionId,
			sessionId,
			state: this.toAgentTerminalEventState(sessionId, event)
		});
	}

	private shouldFlushTerminalEventImmediately(event: TerminalSessionSnapshot): boolean {
		return event.connected === false || event.dead;
	}

	private createTerminalNotificationKey(missionId: string, sessionId: string): string {
		return `${missionId}:${sessionId}`;
	}

	private async ensureMissionTerminalSession(
		loadedMission: LoadedMission
	): Promise<{
		sessionId: string;
		handle: import('../agent/TerminalAgentTransport.js').TerminalSessionHandle;
		snapshot: TerminalSessionSnapshot;
	}> {
		const missionWorkspaceRoot = this.store.getMissionWorkspacePath(loadedMission.mission.getMissionDir());
		const sessionId = this.getMissionTerminalSessionId(missionWorkspaceRoot, loadedMission.missionId);
		const existingHandle = await this.terminalTransport.attachSession(sessionId);
		if (existingHandle) {
			const snapshot = await this.terminalTransport.readSnapshot(existingHandle);
			if (!snapshot.dead) {
				return {
					sessionId,
					handle: existingHandle,
					snapshot
				};
			}
		}

		const openedHandle = await this.terminalTransport.openSession({
			workingDirectory: missionWorkspaceRoot,
			sessionName: sessionId,
			command: resolveMissionTerminalCommand(),
			args: resolveMissionTerminalArgs(),
			env: buildMissionTerminalEnv()
		});
		return {
			sessionId,
			handle: openedHandle,
			snapshot: await this.terminalTransport.readSnapshot(openedHandle)
		};
	}

	private getMissionTerminalSessionId(missionWorkspaceRoot: string, missionId: string): string {
		const repositoryId = deriveRepositoryIdentity(missionWorkspaceRoot).repositoryId;
		return [
			repositoryId,
			slugRepositoryIdentitySegment(missionId) || 'mission'
		].join(':');
	}

	public async executeMethod(request: Request): Promise<unknown> {
		switch (request.method) {
			case 'control.status':
				return this.buildIdleMissionStatus();
			case 'control.settings.update':
				return this.updateControlSettings((request.params ?? {}) as ControlSettingsUpdate);
			case 'control.document.read':
				return this.readControlDocument((request.params ?? {}) as ControlDocumentRead);
			case 'control.document.write':
				return this.writeControlDocument((request.params ?? {}) as ControlDocumentWrite);
			case 'control.workflow.settings.get':
				return this.getWorkflowSettings();
			case 'control.workflow.settings.initialize':
				return this.initializeWorkflowSettings((request.params ?? {}) as ControlWorkflowSettingsInitialize);
			case 'control.workflow.settings.update':
				return this.updateWorkflowSettings((request.params ?? {}) as ControlWorkflowSettingsUpdate);
			case 'control.github.repositories.list':
				return this.listVisibleGitHubRepositories(request);
			case 'control.github.repositories.clone':
				return this.cloneGitHubRepository(
					(request.params ?? {}) as import('../daemon/protocol/contracts.js').ControlGitHubRepositoriesClone,
					request
				);
			case 'control.github.issue.detail':
				return this.getGitHubIssueDetail((request.params ?? {}) as import('../daemon/protocol/contracts.js').ControlGitHubIssueDetail, request);
			case 'control.issues.list':
				return this.listOpenIssues((request.params ?? {}) as ControlIssuesList, request);
			case 'mission.from-issue':
				return this.createMissionFromIssue((request.params ?? {}) as MissionFromIssueRequest, request);
			case 'mission.from-brief':
				return this.createMissionFromBrief((request.params ?? {}) as MissionFromBriefRequest, request);
			case 'control.action.list':
				return this.listControlActions((request.params ?? {}) as ControlActionList);
			case 'control.action.describe':
				return this.describeControlAction((request.params ?? {}) as ControlActionDescribe);
			case 'control.action.execute':
				return this.executeControlAction((request.params ?? {}) as ControlActionExecute);
			case 'mission.status':
				return this.getMissionStatus(this.toMissionParams(request.params, request));
			case 'mission.action.list':
				return this.listMissionActions(this.toMissionParams<MissionActionList>(request.params, request));
			case 'mission.action.execute':
				return this.executeMissionAction(this.toMissionParams<MissionActionExecute>(request.params, request));
			case 'mission.gate.evaluate':
				return this.evaluateGate(this.toMissionParams<MissionGateEvaluate>(request.params, request));
			case 'mission.terminal.state':
				return this.getMissionTerminalState(this.toMissionParams<MissionTerminalStateRequest>(request.params, request));
			case 'mission.terminal.input':
				return this.sendMissionTerminalInput(this.toMissionParams<MissionTerminalInput>(request.params, request));
			case 'session.list':
				return this.listAgentSessions(this.toMissionParams<MissionSelect>(request.params, request));
			case 'session.console.state':
				return this.getAgentConsoleState(this.toMissionParams<SessionConsoleState>(request.params, request));
			case 'session.terminal.state':
				return this.getAgentTerminalState(this.toMissionParams<SessionTerminalState>(request.params, request));
			case 'session.terminal.input':
				return this.sendAgentTerminalInput(this.toMissionParams<SessionTerminalInput>(request.params, request));
			case 'session.prompt':
				return this.promptAgentSession(this.toMissionParams<SessionPrompt>(request.params, request));
			case 'session.command':
				return this.commandAgentSession(this.toMissionParams<SessionCommand>(request.params, request));
			case 'session.complete':
				return this.completeAgentSession(this.toMissionParams<SessionComplete>(request.params, request));
			case 'session.cancel':
				return this.cancelAgentSession(this.toMissionParams<SessionControl>(request.params, request));
			case 'session.terminate':
				return this.terminateAgentSession(this.toMissionParams<SessionControl>(request.params, request));
			default:
				throw new Error(`Unknown server method '${request.method}'.`);
		}
	}

	public async listMissionSelectionCandidates(): Promise<MissionSelectionCandidate[]> {
		return (await this.store.listMissions()).map(({ descriptor }) => ({
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			branchRef: descriptor.branchRef,
			createdAt: descriptor.createdAt,
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
		}));
	}

	private async listOpenIssues(params: ControlIssuesList = {}, request?: Request): Promise<TrackedIssueSummary[]> {
		const settings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		);
		if (settings.trackingProvider !== 'github') {
			return [];
		}
		const githubRepository = resolveGitHubRepositoryFromWorkspace(this.repositoryRoot);
		if (!githubRepository) {
			return [];
		}
		this.requireGitHubAuthentication(request);
		const requestedLimit = typeof params.limit === 'number' && Number.isFinite(params.limit)
			? Math.floor(params.limit)
			: 50;
		const limit = Math.max(1, Math.min(200, requestedLimit));
		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const adapter = new GitHubPlatformAdapter(
			this.repositoryRoot,
			githubRepository,
			authToken ? { authToken } : {}
		);
		return adapter.listOpenIssues(limit);
	}

	private async listVisibleGitHubRepositories(request?: Request) {
		this.requireGitHubAuthentication(request);
		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const adapter = new GitHubPlatformAdapter(
			this.repositoryRoot,
			undefined,
			authToken ? { authToken } : {}
		);
		return adapter.listVisibleRepositories();
	}

	private async getGitHubIssueDetail(
		params: import('../daemon/protocol/contracts.js').ControlGitHubIssueDetail,
		request?: Request
	) {
		const githubRepository = this.requireGitHubRepository();
		this.requireGitHubAuthentication(request);
		const issueNumber = Number.isFinite(params.issueNumber) ? Math.floor(params.issueNumber) : NaN;
		if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
			throw new Error('GitHub issue detail requires a positive issue number.');
		}
		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const adapter = new GitHubPlatformAdapter(
			this.repositoryRoot,
			githubRepository,
			authToken ? { authToken } : {}
		);
		return adapter.fetchIssueDetail(String(issueNumber));
	}

	private async cloneGitHubRepository(
		params: import('../daemon/protocol/contracts.js').ControlGitHubRepositoriesClone,
		request?: Request
	) {
		this.requireGitHubAuthentication(request);
		const githubRepository = params.githubRepository?.trim();
		const destinationPath = params.destinationPath?.trim();
		if (!githubRepository) {
			throw new Error('GitHub repository clone requires a repository name.');
		}
		if (!destinationPath) {
			throw new Error('GitHub repository clone requires a destination path.');
		}
		if (!path.isAbsolute(destinationPath)) {
			throw new Error('GitHub repository clone requires an absolute destination path on the daemon host.');
		}

		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const adapter = new GitHubPlatformAdapter(
			this.repositoryRoot,
			undefined,
			authToken ? { authToken } : {}
		);
		const repositoryRootPath = await adapter.cloneRepository({
			repository: githubRepository,
			destinationPath
		});
		await registerMissionUserRepo(repositoryRootPath);
		const registeredRepository = (await listRegisteredUserRepositories()).find(
			(candidate) => candidate.repositoryRootPath === repositoryRootPath
		);
		if (!registeredRepository) {
			throw new Error(`Mission could not register cloned repository '${githubRepository}'.`);
		}
		return registeredRepository;
	}

	public async buildDiscoveryStatus(
		availableMissions: MissionSelectionCandidate[],
		availableRepositories: ControlSource['availableRepositories'] = []
	): Promise<OperatorStatus> {
		const control = await this.buildControlPlaneStatus(availableMissions.length);

		return {
			found: false,
			operationalMode: this.resolveOperationalMode(control),
			control,
			...(availableRepositories.length > 0 ? { availableRepositories } : {}),
			...(availableMissions.length > 0 ? { availableMissions } : {})
		};
	}

	public async readControlSource(input: {
		availableRepositories?: ControlSource['availableRepositories'];
		selectedMissionId?: string;
		missionStatusHint?: OperatorStatus;
	} = {}): Promise<ControlSource> {
		const availableMissions = await this.listMissionSelectionCandidates();
		const discoveryStatus = await this.buildDiscoveryStatus(availableMissions, input.availableRepositories ?? []);
		const selectedMissionId = input.selectedMissionId?.trim();
		const hintedMissionStatus = input.missionStatusHint?.missionId?.trim()
			&& input.missionStatusHint.missionId.trim() === selectedMissionId
			? input.missionStatusHint
			: undefined;
		const missionStatus = hintedMissionStatus
			?? (selectedMissionId
				? await this.resolveLoadedMissionStatus(selectedMissionId).catch(() => undefined)
				: undefined);
		const repositoryIdentity = deriveRepositoryIdentity(this.repositoryRoot);
		return {
			repositoryId: repositoryIdentity.repositoryId,
			repositoryRootPath: repositoryIdentity.repositoryRootPath,
			control: discoveryStatus.control!,
			availableRepositories: input.availableRepositories ?? [],
			availableMissions,
			...(missionStatus ? { missionStatus } : {})
		};
	}

	private buildDiscoveryAvailableActions(
		control: RepositoryControlStatus,
		availableMissions: MissionSelectionCandidate[],
		openIssues: TrackedIssueSummary[]
	): OperatorActionDescriptor[] {
		const repositoryPresentationTargets = [{
			scope: 'repository' as const,
			targetId: deriveRepositoryIdentity(this.repositoryRoot).repositoryId
		}];
		const issuesCommandEnabled =
			control.trackingProvider === 'github'
			&& control.issuesConfigured;
		const issuesCommandReason =
			control.trackingProvider !== 'github'
				? 'GitHub tracking is not configured for this repository.'
				: !control.issuesConfigured
					? 'GitHub repository configuration is incomplete.'
					: '';
		return [
			{
				id: 'control.repository.init',
				label: 'Prepare the first repository initialization mission',
				action: '/init',
				scope: 'mission',
				disabled: control.initialized,
				disabledReason: control.initialized ? 'This checkout already contains Mission control scaffolding.' : '',
				enabled: !control.initialized,
				ordering: { group: 'recovery' as const },
				ui: {
					toolbarLabel: 'INIT',
					requiresConfirmation: true,
					confirmationPrompt: 'Prepare the first Mission initialization worktree for this repository?'
				},
				presentationTargets: repositoryPresentationTargets,
				...(!control.initialized
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
				...(!control.settingsComplete ? { ordering: { group: 'recovery' as const } } : {}),
				ui: {
					toolbarLabel: 'SETTINGS',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: this.buildSetupCommandFlow(control)
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
				flow: this.buildMissionStartFlow()
			},
			{
				id: 'control.mission.select',
				label: 'Select a local mission',
				action: '/select',
				scope: 'mission',
				disabled: availableMissions.length === 0,
				disabledReason: availableMissions.length > 0 ? '' : 'No local missions are available.',
				enabled: availableMissions.length > 0,
				ui: {
					toolbarLabel: 'OPEN MISSION',
					requiresConfirmation: false
				},
				presentationTargets: repositoryPresentationTargets,
				flow: this.buildMissionSwitchFlow(availableMissions),
				...(availableMissions.length > 0 ? {} : { reason: 'No local missions are available.' })
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
				flow: this.buildMissionIssueFlow(openIssues),
				...(issuesCommandEnabled ? {} : { reason: issuesCommandReason })
			}
		];
	}

	private async executeControlAction(params: ControlActionExecute): Promise<OperatorStatus> {
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
			return this.getMissionStatus({ selector: { missionId } });
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

	private async listControlActions(params: ControlActionList = {}): Promise<OperatorActionListSnapshot> {
		const availableMissions = await this.listMissionSelectionCandidates();
		const control = await this.buildControlPlaneStatus(availableMissions.length);
		let openIssues: TrackedIssueSummary[] = [];
		if (control.trackingProvider === 'github' && control.issuesConfigured) {
			try {
				openIssues = await this.listOpenIssues({ limit: 100 });
			} catch {
				openIssues = [];
			}
		}
		return {
			actions: this.resolveAvailableActions(this.buildDiscoveryAvailableActions(control, availableMissions, openIssues), params.context),
			revision: this.buildControlActionRevision(control)
		};
	}

	private async executeMissionAction(params: MissionActionExecute): Promise<OperatorStatus> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const workspaceStatus = await this.executeWorkspaceMissionAction(loadedMission, params);
		if (workspaceStatus) {
			return workspaceStatus;
		}
		const status = await loadedMission.mission.executeAction(params.actionId, params.steps ?? [], {
			...(params.terminalSessionName?.trim() ? { terminalSessionName: params.terminalSessionName.trim() } : {})
		});
		await this.broadcastMissionStatus(loadedMission.missionId, status);
		return this.decorateMissionStatus(status, 'mission');
	}

	private async listMissionActions(params: MissionActionList): Promise<OperatorActionListSnapshot> {
		const loadedMission = await this.requireMissionContext(params.selector);
		await this.ensureLoadedMissionCommandState(loadedMission);
		const snapshot = await loadedMission.mission.listAvailableActionsSnapshot();
		const status = await loadedMission.mission.status();
		const workspaceActions = await this.buildWorkspaceMissionActions(loadedMission, status);
		return {
			actions: this.resolveAvailableActions([...snapshot.actions, ...workspaceActions], params.context),
			revision: this.buildMissionActionRevision(loadedMission.missionId, status, loadedMission)
		};
	}

	private async createMissionFromBrief(params: MissionFromBriefRequest, request?: Request): Promise<OperatorStatus> {
		const githubRepository = this.requireGitHubRepository();
		this.requireGitHubAuthentication(request);

		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const github = new GitHubPlatformAdapter(
			this.repositoryRoot,
			githubRepository,
			authToken ? { authToken } : {}
		);
		const reconciledBrief = params.brief.issueId !== undefined
			? params.brief
			: await github.createIssue({
				title: params.brief.title,
				body: params.brief.body
			}).then((createdIssue) => ({
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

	private async prepareMissionFromResolvedBrief(
		reconciledBrief: MissionBrief,
		branchRefOverride?: string
	): Promise<OperatorStatus> {
		const existingMission = await this.store.resolveKnownMission({
			...(reconciledBrief.issueId !== undefined ? { issueId: reconciledBrief.issueId } : {}),
			...(branchRefOverride ? { branchRef: branchRefOverride } : {})
		});
		if (existingMission) {
			const status = await this.getMissionStatus({
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
				? this.store.deriveMissionBranchName(reconciledBrief.issueId, reconciledBrief.title)
				: this.store.deriveDraftMissionBranchName(reconciledBrief.title));
		const preparation = await new MissionPreparationService(
			this.store,
			this.buildWorkflowBindings()
		).prepareFromBrief({
			brief: reconciledBrief,
			branchRef: branchRefOverride ?? branchRef
		});
		if (preparation.kind !== 'mission') {
			throw new Error('Mission preparation returned an unexpected non-mission result.');
		}

		const selectedStatus = await this.getMissionStatus({
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

	private async createRepositoryInitializationMission(): Promise<OperatorStatus> {
		if (await this.isRepositoryInitialized()) {
			throw new Error('This checkout already contains Mission control scaffolding.');
		}

		return this.prepareMissionFromResolvedBrief({
			title: 'Initialize Mission repository scaffolding',
			body: [
				'Prepare this repository for Mission inside the first initialization mission worktree.',
				'',
				'Scaffold repository control under .mission/, including settings.json and the repository-owned workflow preset under .mission/workflow/.',
				'Keep the work reviewable on the mission branch and do not mutate the original checkout directly outside this mission flow.',
				'When ready, commit the scaffold on this branch so it can be reviewed and merged back into the repository.'
			].join('\n'),
			type: 'task'
		});
	}

	private async updateControlSettings(params: ControlSettingsUpdate): Promise<OperatorStatus> {
		await this.writeControlSetting(params.field, params.value);
		return this.buildIdleMissionStatus();
	}

	private async readControlDocument(params: ControlDocumentRead): Promise<ControlDocumentResponse> {
		const resolvedPath = this.resolveWorkspaceDocumentPath(params.filePath);
		const content = await fs.readFile(resolvedPath, 'utf8');
		const stats = await fs.stat(resolvedPath);
		return {
			filePath: resolvedPath,
			content,
			updatedAt: stats.mtime.toISOString()
		};
	}

	private async writeControlDocument(params: ControlDocumentWrite): Promise<ControlDocumentResponse> {
		const resolvedPath = this.resolveWorkspaceDocumentPath(params.filePath);
		await fs.writeFile(resolvedPath, params.content, 'utf8');
		const stats = await fs.stat(resolvedPath);
		return {
			filePath: resolvedPath,
			content: params.content,
			updatedAt: stats.mtime.toISOString()
		};
	}

	private async getWorkflowSettings(): Promise<WorkflowSettingsGetResult> {
		return this.workflowSettingsStore.get();
	}

	private async initializeWorkflowSettings(
		params: ControlWorkflowSettingsInitialize
	): Promise<ControlWorkflowSettingsInitializeResponse> {
		const result = await this.workflowSettingsStore.initialize(params);
		return {
			...result,
			status: await this.buildIdleMissionStatus()
		};
	}

	private async updateWorkflowSettings(
		params: ControlWorkflowSettingsUpdate
	): Promise<ControlWorkflowSettingsUpdateResponse> {
		const result = await this.workflowSettingsStore.update(params);
		this.emitEvent({
			type: 'control.workflow.settings.updated',
			revision: result.revision,
			changedPaths: result.changedPaths,
			context: result.context
		});
		return {
			...result,
			status: await this.buildIdleMissionStatus()
		};
	}

	private async createMissionFromIssue(
		params: MissionFromIssueRequest,
		request?: Request
	): Promise<OperatorStatus> {
		const githubRepository = this.requireGitHubRepository();
		this.requireGitHubAuthentication(request);

		const authToken = this.readRequestAuthToken(request);
		refreshSystemStatus({
			cwd: this.repositoryRoot,
			...(authToken ? { authToken } : {})
		});
		const adapter = new GitHubPlatformAdapter(
			this.repositoryRoot,
			githubRepository,
			authToken ? { authToken } : {}
		);
		const brief = await adapter.fetchIssue(String(params.issueNumber));
		return this.prepareMissionFromResolvedBrief(brief);
	}

	private async getMissionStatus(
		params: MissionSelect = {}
	): Promise<OperatorStatus> {
		const loadedMission = await this.requireMissionContext(params.selector);
		return this.decorateMissionStatus(await loadedMission.mission.status(), 'mission');
	}

	private async buildIdleMissionStatus(): Promise<OperatorStatus> {
		return this.buildDiscoveryStatus(await this.listMissionSelectionCandidates());
	}

	private async evaluateGate(params: MissionGateEvaluate) {
		const loadedMission = await this.requireMissionContext(params.selector);
		return loadedMission.mission.evaluateGate(params.intent);
	}

	private async getMissionTerminalState(
		params: MissionTerminalStateRequest
	): Promise<MissionAgentTerminalState | null> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const terminal = await this.ensureMissionTerminalSession(loadedMission);
		return this.toAgentTerminalState(terminal.sessionId, terminal.snapshot);
	}

	private async sendMissionTerminalInput(
		params: MissionTerminalInput
	): Promise<MissionAgentTerminalState | null> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const terminal = await this.ensureMissionTerminalSession(loadedMission);

		if (params.cols !== undefined && params.rows !== undefined) {
			await this.terminalTransport.resizeSession(terminal.handle, params.cols, params.rows);
		}
		if (typeof params.data === 'string' && params.data.length > 0) {
			await this.terminalTransport.sendKeys(terminal.handle, params.data, {
				...(params.literal !== undefined ? { literal: params.literal } : {})
			});
		}

		if (params.respondWithState === false) {
			return null;
		}

		return this.toAgentTerminalState(
			terminal.sessionId,
			await this.terminalTransport.readSnapshot(terminal.handle)
		);
	}

	private async listAgentSessions(
		params: MissionSelect = {}
	) {
		const loadedMission = await this.requireMissionContext(params.selector);
		return loadedMission.mission.getAgentSessions();
	}

	private async getAgentConsoleState(
		params: SessionConsoleState
	): Promise<MissionAgentConsoleState | null> {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.getAgentConsoleState(params.sessionId) ?? null;
	}

	private async getAgentTerminalState(
		params: SessionTerminalState
	): Promise<MissionAgentTerminalState | null> {
		const loadedMission = await this.requireMissionSession(params);
		const session = loadedMission.mission.getAgentSession(params.sessionId);
		if (!session || session.transportId !== 'terminal' || !session.terminalSessionName) {
			return null;
		}

		const handle = await this.terminalTransport.attachSession(session.terminalSessionName, {
			...(session.terminalPaneId ? { paneId: session.terminalPaneId } : {})
		});
		if (!handle) {
			return this.toAgentTerminalState(session.sessionId);
		}

		return this.toAgentTerminalState(session.sessionId, await this.terminalTransport.readSnapshot(handle));
	}

	private async sendAgentTerminalInput(
		params: SessionTerminalInput
	): Promise<MissionAgentTerminalState | null> {
		const loadedMission = await this.requireMissionSession(params);
		const session = loadedMission.mission.getAgentSession(params.sessionId);
		if (!session || session.transportId !== 'terminal' || !session.terminalSessionName) {
			return null;
		}

		const handle = await this.terminalTransport.attachSession(session.terminalSessionName, {
			...(session.terminalPaneId ? { paneId: session.terminalPaneId } : {})
		});
		if (!handle) {
			return this.toAgentTerminalState(session.sessionId);
		}

		if (params.cols !== undefined && params.rows !== undefined) {
			await this.terminalTransport.resizeSession(handle, params.cols, params.rows);
		}
		if (typeof params.data === 'string' && params.data.length > 0) {
			await this.terminalTransport.sendKeys(handle, params.data, {
				...(params.literal !== undefined ? { literal: params.literal } : {})
			});
		}

		if (params.respondWithState === false) {
			return null;
		}

		return this.toAgentTerminalState(session.sessionId, await this.terminalTransport.readSnapshot(handle));
	}

	private async cancelAgentSession(params: SessionControl) {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.cancelAgentSession(params.sessionId, params.reason);
	}

	private async promptAgentSession(params: SessionPrompt) {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.sendAgentSessionPrompt(params.sessionId, params.prompt as AgentPrompt);
	}

	private async commandAgentSession(params: SessionCommand) {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.sendAgentSessionCommand(params.sessionId, params.command as AgentCommand);
	}

	private async completeAgentSession(params: SessionComplete) {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.completeAgentSession(params.sessionId);
	}

	private async terminateAgentSession(params: SessionControl) {
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.terminateAgentSession(params.sessionId, params.reason);
	}

	private resolveAvailableActions(
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

	private async ensureLoadedMissionCommandState(loadedMission: LoadedMission): Promise<void> {
		if (loadedMission.commandState.repositorySync) {
			return;
		}
		await this.refreshLoadedMissionCommandState(loadedMission);
	}

	private async refreshLoadedMissionCommandState(loadedMission: LoadedMission): Promise<void> {
		loadedMission.commandState.repositorySync = this.resolveRepositorySyncState(loadedMission);
	}

	private resolveRepositorySyncState(loadedMission: LoadedMission): RepositorySyncState {
		const checkedAt = new Date().toISOString();
		const settings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		);
		const missionWorkspaceRoot = this.store.getMissionWorkspacePath(loadedMission.mission.getMissionDir());
		const githubRepository = resolveGitHubRepositoryFromWorkspace(missionWorkspaceRoot)
			?? resolveGitHubRepositoryFromWorkspace(this.repositoryRoot);

		if (settings.trackingProvider !== 'github' || !githubRepository) {
			return {
				provider: 'github',
				status: 'unsupported',
				branchRef: loadedMission.branchRef,
				checkedAt,
				revision: `workspace-mission-sync:${loadedMission.missionId}:unsupported`,
				reason: 'GitHub tracking is not configured for this mission repository.'
			};
		}

		try {
			const ghBinary = getMissionGitHubCliBinary();
			const adapter = new GitHubPlatformAdapter(
				missionWorkspaceRoot,
				githubRepository,
				ghBinary ? { ghBinary } : {}
			);
			const worktreeClean = this.store.isWorktreeClean(missionWorkspaceRoot);
			adapter.fetchRemote('origin');
			const sync = adapter.getBranchSyncStatus(loadedMission.branchRef, 'origin');
			return {
				provider: 'github',
				status: sync.status,
				branchRef: sync.branchRef,
				checkedAt,
				revision: `workspace-mission-sync:${loadedMission.missionId}:${sync.status}:${worktreeClean ? 'clean' : 'dirty'}:${sync.remoteHead ?? 'none'}:${String(sync.aheadCount)}:${String(sync.behindCount)}`,
				worktreeClean,
				aheadCount: sync.aheadCount,
				behindCount: sync.behindCount,
				...(sync.trackingRef ? { trackingRef: sync.trackingRef } : {}),
				...(sync.localHead ? { localHead: sync.localHead } : {}),
				...(sync.remoteHead ? { remoteHead: sync.remoteHead } : {})
			};
		} catch (error) {
			return {
				provider: 'github',
				status: 'error',
				branchRef: loadedMission.branchRef,
				checkedAt,
				revision: `workspace-mission-sync:${loadedMission.missionId}:error`,
				reason: error instanceof Error ? error.message : String(error)
			};
		}
	}

	private async buildWorkspaceMissionActions(
		loadedMission: LoadedMission,
		status: OperatorStatus
	): Promise<OperatorActionDescriptor[]> {
		const context: RepositoryCommandContext = {
			loadedMission,
			missionStatus: status,
			...((status.workflow?.currentStageId ?? status.stage)
				? { currentStageId: (status.workflow?.currentStageId ?? status.stage) }
				: {}),
			...(loadedMission.commandState.repositorySync
				? { repositorySync: loadedMission.commandState.repositorySync }
				: {})
		};

		return Promise.all(REPOSITORY_MISSION_COMMAND_DEFINITIONS.map(async (definition) => {
			const evaluation = definition.evaluate(context);
			const flow = definition.buildFlow
				? await definition.buildFlow(this, context)
				: undefined;
			return buildRepositoryMissionCommandDescriptor(definition, context, evaluation, flow);
		}));
	}

	private async executeWorkspaceMissionAction(
		loadedMission: LoadedMission,
		params: MissionActionExecute
	): Promise<OperatorStatus | undefined> {
		const definition = REPOSITORY_MISSION_COMMAND_DEFINITIONS.find((candidate) => candidate.id === params.actionId);
		if (!definition) {
			return undefined;
		}
		if (!definition.buildFlow && (params.steps ?? []).length > 0) {
			throw new Error(`Mission action '${params.actionId}' does not accept input steps.`);
		}

		await this.ensureLoadedMissionCommandState(loadedMission);
		const status = await loadedMission.mission.status();
		const context: RepositoryCommandContext = {
			loadedMission,
			missionStatus: status,
			...((status.workflow?.currentStageId ?? status.stage)
				? { currentStageId: (status.workflow?.currentStageId ?? status.stage) }
				: {}),
			...(loadedMission.commandState.repositorySync
				? { repositorySync: loadedMission.commandState.repositorySync }
				: {})
		};
		const evaluation = definition.evaluate(context);
		if (!evaluation.enabled) {
			throw new Error(evaluation.reason ?? `Mission action '${params.actionId}' is unavailable.`);
		}

		switch (definition.id) {
			case 'mission.pull-origin':
				this.pullMissionOrigin(loadedMission);
				await loadedMission.mission.refresh();
				break;
			case 'mission.changeset.add':
				await this.createMissionChangeset(loadedMission, params.steps ?? []);
				break;
			default:
				throw new Error(`Unsupported workspace mission action '${definition.id}'.`);
		}
		await this.refreshLoadedMissionCommandState(loadedMission);
		const refreshedStatus = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, refreshedStatus);
		return this.decorateMissionStatus(refreshedStatus, 'mission');
	}

	private pullMissionOrigin(loadedMission: LoadedMission): void {
		const missionWorkspaceRoot = this.store.getMissionWorkspacePath(loadedMission.mission.getMissionDir());
		if (!this.store.isWorktreeClean(missionWorkspaceRoot)) {
			throw new Error('Mission worktree has local changes. Commit, stash, or discard them before pulling origin.');
		}
		const githubRepository = resolveGitHubRepositoryFromWorkspace(missionWorkspaceRoot)
			?? resolveGitHubRepositoryFromWorkspace(this.repositoryRoot);
		if (!githubRepository) {
			throw new Error('GitHub repository configuration is incomplete for this mission.');
		}

		const ghBinary = getMissionGitHubCliBinary();
		const adapter = new GitHubPlatformAdapter(
			missionWorkspaceRoot,
			githubRepository,
			ghBinary ? { ghBinary } : {}
		);
		adapter.pullBranch(loadedMission.branchRef, 'origin');
	}

	async buildMissionChangesetFlow(): Promise<OperatorActionFlowDescriptor> {
		const packages = await this.listReleasableWorkspacePackages();
		return {
			targetLabel: 'MISSION',
			actionLabel: 'ADD CHANGESET',
			steps: [
				{
					kind: 'selection',
					id: 'changeset.packages',
					label: 'Packages',
					title: 'Select packages for this changeset',
					emptyLabel: 'No releasable workspace packages are available.',
					helperText: 'Choose one or more releasable workspace packages to include.',
					selectionMode: 'multiple',
					options: packages.map((pkg) => ({
						id: pkg.name,
						label: pkg.name,
						description: pkg.relativePath
					}))
				},
				{
					kind: 'selection',
					id: 'changeset.bump',
					label: 'Release type',
					title: 'Select the release type',
					emptyLabel: 'No release types available.',
					helperText: 'Use one release type for all selected packages in this changeset.',
					selectionMode: 'single',
					options: CHANGESET_RELEASE_TYPE_OPTIONS
				},
				{
					kind: 'text',
					id: 'changeset.summary',
					label: 'Summary',
					title: 'Describe the release change',
					helperText: 'This summary becomes the body of the generated changeset file.',
					placeholder: 'Summarize what changed and why it should be released.',
					inputMode: 'expanded',
					format: 'markdown'
				}
			]
		};
	}

	private async createMissionChangeset(
		loadedMission: LoadedMission,
		steps: OperatorActionExecutionStep[]
	): Promise<void> {
		const packageStep = requireSelectionActionStep(steps, 'changeset.packages');
		const releaseType = asChangesetReleaseType(requireSingleValueActionStep(steps, 'changeset.bump'));
		if (!releaseType) {
			throw new Error('Changeset action requires a valid release type.');
		}
		const summary = requireTextActionStep(steps, 'changeset.summary').value.trim();
		if (summary.length === 0) {
			throw new Error('Changeset action requires a non-empty summary.');
		}

		const releasablePackages = await this.listReleasableWorkspacePackages();
		const allowedPackageNames = new Set(releasablePackages.map((pkg) => pkg.name));
		const packageNames = packageStep.optionIds
			.map((optionId) => optionId.trim())
			.filter((optionId, index, optionIds) => optionId.length > 0 && optionIds.indexOf(optionId) === index);
		if (packageNames.length === 0) {
			throw new Error('Changeset action requires at least one package selection.');
		}
		for (const packageName of packageNames) {
			if (!allowedPackageNames.has(packageName)) {
				throw new Error(`Changeset action cannot target unknown package '${packageName}'.`);
			}
		}

		const changesetDir = path.join(this.repositoryRoot, '.changeset');
		await fs.mkdir(changesetDir, { recursive: true });
		const filePath = path.join(
			changesetDir,
			`${createChangesetFileSlug(loadedMission.missionId, summary)}.md`
		);
		const frontmatter = packageNames
			.map((packageName) => `"${packageName}": ${releaseType}`)
			.join('\n');
		const content = `---\n${frontmatter}\n---\n\n${summary}\n`;
		await fs.writeFile(filePath, content, 'utf8');
	}

	private async listReleasableWorkspacePackages(): Promise<Array<{ name: string; relativePath: string }>> {
		const ignoredPackages = await this.readIgnoredChangesetPackages();
		const manifests = await Promise.all([
			this.readWorkspacePackageManifests(path.join(this.repositoryRoot, 'packages'), 'packages', 1),
			this.readWorkspacePackageManifests(path.join(this.repositoryRoot, 'apps'), 'apps', 2)
		]);
		return manifests
			.flat()
			.filter((manifest) => !manifest.private && !ignoredPackages.has(manifest.name))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	private async readIgnoredChangesetPackages(): Promise<Set<string>> {
		const configPath = path.join(this.repositoryRoot, '.changeset', 'config.json');
		try {
			const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as { ignore?: unknown };
			if (!Array.isArray(config.ignore)) {
				return new Set();
			}
			return new Set(
				config.ignore.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
			);
		} catch {
			return new Set();
		}
	}

	private async readWorkspacePackageManifests(
		rootPath: string,
		basePath: string,
		depth: number
	): Promise<Array<{ name: string; private: boolean; relativePath: string }>> {
		try {
			const manifests: Array<{ name: string; private: boolean; relativePath: string }> = [];
			const firstLevelEntries = await fs.readdir(rootPath, { withFileTypes: true });
			for (const firstLevelEntry of firstLevelEntries) {
				if (!firstLevelEntry.isDirectory()) {
					continue;
				}
				if (depth === 1) {
					const manifest = await this.readWorkspacePackageManifest(basePath, [firstLevelEntry.name]);
					if (manifest) {
						manifests.push(manifest);
					}
					continue;
				}
				const secondLevelPath = path.join(rootPath, firstLevelEntry.name);
				const secondLevelEntries = await fs.readdir(secondLevelPath, { withFileTypes: true });
				for (const secondLevelEntry of secondLevelEntries) {
					if (!secondLevelEntry.isDirectory()) {
						continue;
					}
					const manifest = await this.readWorkspacePackageManifest(basePath, [firstLevelEntry.name, secondLevelEntry.name]);
					if (manifest) {
						manifests.push(manifest);
					}
				}
			}
			return manifests;
		} catch {
			return [];
		}
	}

	private async readWorkspacePackageManifest(
		basePath: string,
		segments: string[]
	): Promise<{ name: string; private: boolean; relativePath: string } | undefined> {
		const relativePath = path.posix.join(basePath, ...segments);
		const manifestPath = path.join(this.repositoryRoot, ...relativePath.split('/'), 'package.json');
		try {
			const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
				name?: unknown;
				private?: unknown;
			};
			if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
				return undefined;
			}
			return {
				name: manifest.name,
				private: manifest.private === true,
				relativePath
			};
		} catch {
			return undefined;
		}
	}

	private async broadcastMissionStatus(missionId: string, status: OperatorStatus): Promise<void> {
		const decoratedStatus = await this.decorateMissionStatus(status, 'mission');
		const loadedMission = this.loadedMissions.get(missionId);
		this.emitEvent({
			type: 'mission.status',
			workspaceRoot: this.repositoryRoot,
			missionId,
			status: decoratedStatus
		});
		this.emitEvent({
			type: 'mission.actions.changed',
			workspaceRoot: this.repositoryRoot,
			missionId,
			revision: this.buildMissionActionRevision(missionId, decoratedStatus, loadedMission)
		});
	}

	private async broadcastMissionStatusSnapshot(loadedMission: LoadedMission): Promise<void> {
		const status = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, status);
	}

	private async decorateMissionStatus(
		status: OperatorStatus,
		operationalMode: Extract<MissionOperationalMode, 'root' | 'mission'>,
		options: { availableMissionCount?: number } = {}
	): Promise<OperatorStatus> {
		const control = await this.buildControlPlaneStatus(options.availableMissionCount);
		return {
			...status,
			operationalMode: operationalMode === 'mission' ? 'mission' : this.resolveOperationalMode(control),
			control
		};
	}

	private buildWorkflowBindings(): MissionWorkflowBindings {
		const settings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		);
		const resolveWorkflow = () => {
			const liveSettings = getDefaultMissionDaemonSettingsWithOverrides(
				readMissionDaemonSettings(this.repositoryRoot) ?? {}
			);
			const configuredWorkflow = liveSettings.workflow ?? createDefaultWorkflowSettings();
			return this.agentRunners.size > 0
				? configuredWorkflow
				: this.disableWorkflowAutostart(configuredWorkflow);
		};
		const workflow = resolveWorkflow();
		return {
			workflow,
			resolveWorkflow,
			taskRunners: new Map(this.agentRunners),
			...(settings.instructionsPath
				? {
					instructionsPath: path.isAbsolute(settings.instructionsPath)
						? settings.instructionsPath
						: path.join(this.repositoryRoot, settings.instructionsPath)
				}
				: {}),
			...(settings.skillsPath
				? {
					skillsPath: path.isAbsolute(settings.skillsPath)
						? settings.skillsPath
						: path.join(this.repositoryRoot, settings.skillsPath)
				}
				: {}),
			...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
			...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {})
		};
	}

	private disableWorkflowAutostart(workflow: MissionWorkflowBindings['workflow']): MissionWorkflowBindings['workflow'] {
		return {
			...workflow,
			stages: Object.fromEntries(
				Object.entries(workflow.stages).map(([stageId, stage]) => [
					stageId,
					{
						...stage,
						taskLaunchPolicy: {
							...stage.taskLaunchPolicy,
							defaultAutostart: false
						}
					}
				])
			) as MissionWorkflowBindings['workflow']['stages']
		};
	}

	private async isRepositoryInitialized(): Promise<boolean> {
		try {
			await Promise.all([
				fs.access(getMissionDirectoryPath(this.repositoryRoot)),
				fs.access(getMissionDaemonSettingsPath(this.repositoryRoot)),
				fs.access(getMissionWorkflowDefinitionPath(this.repositoryRoot))
			]);
			return true;
		} catch {
			return false;
		}
	}

	private async buildControlPlaneStatus(
		availableMissionCount?: number
	): Promise<RepositoryControlStatus> {
		const settings = readMissionDaemonSettings(this.repositoryRoot);
		const effectiveSettings = getDefaultMissionDaemonSettingsWithOverrides(settings ?? {});
		const githubRepository = effectiveSettings.trackingProvider === 'github'
			? resolveGitHubRepositoryFromWorkspace(this.repositoryRoot)
			: undefined;
		const issuesConfigured = effectiveSettings.trackingProvider === 'github' && Boolean(githubRepository);
		const problems: string[] = [];
		const warnings: string[] = [];
		const isGitRepository = this.store.isGitRepository();
		const initialized = await this.isRepositoryInitialized();
		if (!isGitRepository) {
			problems.push('Mission requires a Git repository.');
		}
		if (!initialized || !settings) {
			warnings.push('Mission control will be created in the first mission worktree if it is not already present on this checkout.');
		}
		if (!effectiveSettings.agentRunner) {
			problems.push('Mission control agent runner is not configured.');
		}
		if (!effectiveSettings.defaultAgentMode) {
			problems.push('Mission control default agent mode is not configured.');
		}
		if (!effectiveSettings.defaultModel) {
			problems.push('Mission control default model is not configured.');
		}
		if (effectiveSettings.trackingProvider === 'github' && !githubRepository) {
			warnings.push('Mission could not resolve a GitHub repository from the current workspace.');
		}

		return {
			controlRoot: this.repositoryRoot,
			missionDirectory: getMissionDirectoryPath(this.repositoryRoot),
			settingsPath: getMissionDaemonSettingsPath(this.repositoryRoot),
			worktreesPath: getMissionWorktreesPath(
				this.repositoryRoot,
				effectiveSettings.missionWorkspaceRoot
					? { missionWorkspaceRoot: effectiveSettings.missionWorkspaceRoot }
					: {}
			),
			...(isGitRepository ? { currentBranch: this.store.getCurrentBranch() } : {}),
			settings: effectiveSettings,
			isGitRepository,
			initialized,
			settingsPresent: settings !== undefined,
			settingsComplete: problems.length === 0,
			...(effectiveSettings.trackingProvider ? { trackingProvider: effectiveSettings.trackingProvider } : {}),
			...(githubRepository ? { githubRepository } : {}),
			issuesConfigured,
			availableMissionCount:
				availableMissionCount ?? (await this.store.listMissions()).length,
			problems,
			warnings
		};
	}

	private resolveOperationalMode(control: RepositoryControlStatus): Extract<MissionOperationalMode, 'setup' | 'root'> {
		return control.problems.length > 0 ? 'setup' : 'root';
	}

	private buildControlActionRevision(control: RepositoryControlStatus): string {
		return JSON.stringify({
			scope: 'control',
			settingsPath: control.settingsPath,
			settingsComplete: control.settingsComplete,
			availableMissionCount: control.availableMissionCount,
			currentBranch: control.currentBranch ?? null,
			trackingProvider: control.trackingProvider ?? null
		});
	}

	private buildMissionActionRevision(
		missionId: string,
		status: OperatorStatus,
		loadedMission?: LoadedMission
	): string {
		const repositorySyncRevision = loadedMission?.commandState.repositorySync?.revision;
		const workflowUpdatedAt = status.workflow?.updatedAt?.trim();
		if (workflowUpdatedAt) {
			return `mission:${missionId}:${workflowUpdatedAt}:${repositorySyncRevision ?? 'workspace'}`;
		}
		const systemVersion = status.system?.state.version;
		if (typeof systemVersion === 'number') {
			return `mission:${missionId}:system:${String(systemVersion)}:${repositorySyncRevision ?? 'workspace'}`;
		}
		return `mission:${missionId}:status:${repositorySyncRevision ?? 'workspace'}`;
	}

	private buildSetupCommandFlow(
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

	private buildSetupCommandFlowOptions(
		control: RepositoryControlStatus
	): OperatorActionFlowOption[] {
		return [
			{
				id: 'agentRunner',
				label: 'Agent Runner',
				description: control.settings.agentRunner?.trim() || 'Required'
			},
			{
				id: 'defaultAgentMode',
				label: 'Default Agent Mode',
				description: control.settings.defaultAgentMode?.trim() || 'Required'
			},
			{
				id: 'defaultModel',
				label: 'Default Model',
				description: control.settings.defaultModel?.trim() || 'Required'
			},
			{
				id: 'towerTheme',
				label: 'Tower Theme',
				description: control.settings.towerTheme?.trim() || 'ocean'
			},
			{
				id: 'missionWorkspaceRoot',
				label: 'Mission Workspace Root',
				description: control.settings.missionWorkspaceRoot?.trim() || 'missions'
			},
			{
				id: 'instructionsPath',
				label: 'Instructions Path',
				description: control.settings.instructionsPath?.trim() || '.agents'
			},
			{
				id: 'skillsPath',
				label: 'Skills Path',
				description: control.settings.skillsPath?.trim() || '.agents/skills'
			}
		];
	}

	private buildSetupValueStep(
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
				], control.settings.agentRunner)
			};
		}
		if (selectedField === 'defaultAgentMode') {
			const configuredRunnerId = control.settings.agentRunner?.trim();
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
				], control.settings.defaultAgentMode)
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
				], control.settings.towerTheme)
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

	private resolveSetupTextInitialValue(
		control: RepositoryControlStatus,
		selectedField: ControlSettingsUpdate['field'] | undefined
	): string {
		if (selectedField === 'instructionsPath') {
			return control.settings.instructionsPath ?? '';
		}
		if (selectedField === 'skillsPath') {
			return control.settings.skillsPath ?? '';
		}
		if (selectedField === 'defaultModel') {
			return control.settings.defaultModel ?? '';
		}
		if (selectedField === 'missionWorkspaceRoot') {
			return control.settings.missionWorkspaceRoot ?? '';
		}
		return '';
	}

	private orderSelectedOptionFirst(
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

	private buildMissionStartFlow(): OperatorActionFlowDescriptor {
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

	private buildMissionTypeOptions(): OperatorActionFlowOption[] {
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

	private buildMissionSwitchFlow(
		availableMissions: MissionSelectionCandidate[]
	): OperatorActionFlowDescriptor {
		return {
			targetLabel: 'MISSION',
			actionLabel: 'SWITCH',
			steps: [
				{
					kind: 'selection',
					id: 'mission',
					label: 'MISSION',
					title: 'SELECT MISSION',
					emptyLabel: `No local missions are available under ${this.store.getMissionsPath()}.`,
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

	private buildMissionIssueFlow(
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

	private async describeControlAction(
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
			return this.buildMissionIssueFlow(await this.listOpenIssues({ limit: 100 }));
		}
		throw new Error(`Unsupported control action '${params.actionId}'.`);
	}

	private async writeControlSetting(
		field: ControlSettingsUpdate['field'],
		rawValue: string
	): Promise<void> {
		if (!(await this.isRepositoryInitialized())) {
			throw new Error(
				'Repository settings cannot be edited locally until the initialization mission scaffold is merged and pulled into this checkout.'
			);
		}

		const nextSettings: MissionDaemonSettings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		);
		const value = rawValue.trim();

		switch (field) {
			case 'agentRunner':
				if (value.length === 0) {
					delete nextSettings.agentRunner;
					break;
				}
				if (value !== 'copilot-cli' && value !== 'pi') {
					throw new Error(`Unsupported Mission agent runner '${value}'.`);
				}
				nextSettings.agentRunner = value;
				break;
			case 'defaultAgentMode':
				if (value.length === 0) {
					delete nextSettings.defaultAgentMode;
					break;
				}
				if (value !== 'interactive' && value !== 'autonomous') {
					throw new Error(`Unsupported Mission default agent mode '${value}'.`);
				}
				nextSettings.defaultAgentMode = value;
				break;
			case 'defaultModel':
				if (value.length === 0) {
					delete nextSettings.defaultModel;
					break;
				}
				nextSettings.defaultModel = value;
				break;
			case 'towerTheme':
				if (value.length === 0) {
					delete nextSettings.towerTheme;
					break;
				}
				nextSettings.towerTheme = value;
				break;
			case 'missionWorkspaceRoot':
				if (value.length === 0) {
					delete nextSettings.missionWorkspaceRoot;
					break;
				}
				nextSettings.missionWorkspaceRoot = value;
				break;
			case 'instructionsPath':
				if (value.length === 0) {
					delete nextSettings.instructionsPath;
					break;
				}
				nextSettings.instructionsPath = value;
				break;
			case 'skillsPath':
				if (value.length === 0) {
					delete nextSettings.skillsPath;
					break;
				}
				nextSettings.skillsPath = value;
				break;
			default:
				throw new Error(`Unsupported Mission setting '${field}'.`);
		}

		await writeMissionDaemonSettings(nextSettings, this.repositoryRoot);
	}

	private isAutopilotConfigured(): boolean {
		return false;
	}

	private requireGitHubRepository(): string {
		const settings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		);
		if (settings.trackingProvider !== 'github') {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}

		const githubRepository = resolveGitHubRepositoryFromWorkspace(this.repositoryRoot);
		if (!githubRepository) {
			throw new Error('Mission could not resolve a GitHub repository from the current workspace.');
		}

		return githubRepository;
	}

	private requireGitHubAuthentication(request?: Request): void {
		if (this.readRequestAuthToken(request)) {
			return;
		}

		const systemStatus = refreshSystemStatus({ cwd: this.repositoryRoot });
		if (!systemStatus.github.authenticated) {
			throw new Error(systemStatus.github.detail ?? 'GitHub CLI authentication is required.');
		}
	}

	private readRequestAuthToken(request?: Request): string | undefined {
		const authToken = request?.authToken?.trim();
		return authToken && authToken.length > 0 ? authToken : undefined;
	}

	private toMissionParams<T extends MissionSelect>(params: unknown, request?: Request): T {
		const base = params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {};
		const requestedSelector = isMissionSelectorRecord(base['selector']) ? base['selector'] : {};
		const surfaceSelector = request?.surfacePath?.trim()
			? resolveMissionWorkspaceContext(request.surfacePath, this.repositoryRoot).selector
			: {};
		const selector = normalizeMissionSelector({
			...surfaceSelector,
			...requestedSelector
		});

		if (!hasMissionSelector(selector)) {
			return base as T;
		}

		return {
			...base,
			selector
		} as T;
	}

	private resolveWorkspaceDocumentPath(filePath: string): string {
		const trimmedPath = filePath.trim();
		if (trimmedPath.length === 0) {
			throw new Error('Document path is required.');
		}
		const resolvedPath = path.resolve(this.repositoryRoot, trimmedPath);
		const relativePath = path.relative(this.repositoryRoot, resolvedPath);
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			throw new Error(`Document path '${filePath}' is outside the Mission workspace.`);
		}
		return resolvedPath;
	}

	private async resolveLoadedMission(
		selector: MissionSelector = {},
		options: { allowMissing?: boolean; requireMissionId?: boolean } = {}
	): Promise<LoadedMission | undefined> {
		const normalizedSelector = normalizeMissionSelector(selector);

		if (options.requireMissionId && !normalizedSelector.missionId) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('Mission operations require an explicit missionId selector.');
		}

		if (!hasMissionSelector(normalizedSelector)) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('No mission selector was provided.');
		}

		const existing = await this.findLoadedMission(normalizedSelector);
		if (existing) {
			await this.ensureLoadedMissionCommandState(existing);
			this.assertSelectorMatchesLoadedMission(normalizedSelector, existing);
			return existing;
		}

		const resolvedMission = await this.store.resolveKnownMission(normalizedSelector);
		if (!resolvedMission) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('No tracked mission could be resolved for this workspace.');
		}

		const mission = await Factory.load(this.store, {
			missionId: resolvedMission.descriptor.missionId,
		}, this.buildWorkflowBindings());
		if (!mission) {
			throw new Error(`Mission '${resolvedMission.descriptor.missionId}' could not be loaded.`);
		}

		const loadedMission = this.registerLoadedMission(mission, {
			autopilotEnabled: this.isAutopilotConfigured()
		});
		await this.ensureLoadedMissionCommandState(loadedMission);
		void this.broadcastMissionStatusSnapshot(loadedMission);
		this.assertSelectorMatchesLoadedMission(normalizedSelector, loadedMission);
		return loadedMission;
	}

	private async requireMissionContext(selector: MissionSelector = {}): Promise<LoadedMission> {
		const loadedMission = await this.resolveLoadedMission(selector, { requireMissionId: true });
		if (!loadedMission) {
			throw new Error('Mission operations require an explicit missionId selector.');
		}

		return loadedMission;
	}

	private async requireMissionSession(
		params: SessionConsoleState
	): Promise<LoadedMission> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const session = loadedMission.mission.getAgentSession(params.sessionId);
		if (!session) {
			throw new Error(
				`Mission agent session '${params.sessionId}' is not attached to mission '${loadedMission.missionId}'.`
			);
		}

		return loadedMission;
	}

	private async findLoadedMission(selector: MissionSelector): Promise<LoadedMission | undefined> {
		const existingById = selector.missionId ? this.loadedMissions.get(selector.missionId) : undefined;
		if (existingById) {
			return existingById;
		}

		for (const loadedMission of this.loadedMissions.values()) {
			if (!this.selectorMatchesLoadedMission(selector, loadedMission)) {
				continue;
			}

			return loadedMission;
		}

		return undefined;
	}

	private async resolveLoadedMissionStatus(missionId: string): Promise<OperatorStatus | undefined> {
		const loadedMission = await this.resolveLoadedMission({ missionId }, { requireMissionId: true, allowMissing: true });
		if (!loadedMission) {
			return undefined;
		}
		return loadedMission.mission.status();
	}

	private registerLoadedMission(
		mission: Mission,
		options: { autopilotEnabled?: boolean } = {}
	): LoadedMission {
		const record = mission.getRecord();
		const existing = this.loadedMissions.get(record.id);
		if (existing) {
			if (options.autopilotEnabled === true) {
				this.enableAutopilot(existing);
			}
			mission.dispose();
			return existing;
		}

		const loadedMission: LoadedMission = {
			missionId: record.id,
			branchRef: record.branchRef,
			mission,
			commandState: {},
			autopilotEnabled: options.autopilotEnabled === true,
			autopilotQueue: Promise.resolve(),
			consoleSubscription: { dispose: () => undefined },
			eventSubscription: { dispose: () => undefined },
		};

		loadedMission.consoleSubscription = mission.onDidAgentConsoleEvent((event) => {
			if (!event.state.sessionId) {
				return;
			}
			this.emitEvent({
				type: 'session.console',
				missionId: record.id,
				sessionId: event.state.sessionId,
				event
			});
		});
		loadedMission.eventSubscription = mission.onDidAgentEvent((event) => {
			this.emitEvent({
				type: 'session.event',
				missionId: record.id,
				sessionId: event.state.sessionId,
				event
			});
			const phaseEvent = this.toSessionPhaseNotification(record.id, event);
			if (phaseEvent) {
				this.emitEvent(phaseEvent);
			}
			if (shouldBroadcastMissionStatusForAgentEvent(event)) {
				void this.broadcastMissionStatusSnapshot(loadedMission);
			}
			if (shouldScheduleAutopilotForAgentEvent(event)) {
				this.scheduleAutopilot(loadedMission, event);
			}
		});

		this.loadedMissions.set(loadedMission.missionId, loadedMission);
		this.scheduleAutopilot(loadedMission);
		return loadedMission;
	}

	private enableAutopilot(loadedMission: LoadedMission): void {
		if (loadedMission.autopilotEnabled) {
			return;
		}

		loadedMission.autopilotEnabled = true;
		this.scheduleAutopilot(loadedMission);
	}

	private scheduleAutopilot(
		loadedMission: LoadedMission,
		event?: MissionAgentEvent
	): void {
		if (!loadedMission.autopilotEnabled) {
			return;
		}

		loadedMission.autopilotQueue = loadedMission.autopilotQueue
			.catch(() => undefined)
			.then(async () => {
				if (!this.isLoadedMissionActive(loadedMission) || !loadedMission.autopilotEnabled) {
					return;
				}

				if (event) {
					await this.handleAutopilotEvent(loadedMission, event);
				}

				await this.runAutopilotLoop(loadedMission);
			})
			.catch((error) => {
				void error;
			});
	}

	private async handleAutopilotEvent(
		loadedMission: LoadedMission,
		event: MissionAgentEvent
	): Promise<void> {
		void loadedMission;
		void event;
	}

	private async runAutopilotLoop(loadedMission: LoadedMission): Promise<void> {
		for (let iteration = 0; iteration < 50; iteration += 1) {
			if (!this.isLoadedMissionActive(loadedMission) || !loadedMission.autopilotEnabled) {
				return;
			}

			const status = await loadedMission.mission.status();

			const currentStageId = status.stage;
			if (!currentStageId) {
				return;
			}

			const runningTaskIds = new Set(
				(status.agentSessions ?? [])
					.filter((session) => this.isRunningSession(session))
					.flatMap((session) => (session.taskId ? [session.taskId] : []))
			);
			const launchableTaskIds = [
				...(status.activeTasks ?? []).map((task) => task.taskId),
				...(status.readyTasks ?? []).map((task) => task.taskId)
			].filter((taskId, index, taskIds) => taskIds.indexOf(taskId) === index && !runningTaskIds.has(taskId));

			if (launchableTaskIds.length > 0) {
				for (const taskId of launchableTaskIds) {
					await this.launchAutopilotTaskSession(loadedMission, status, taskId);
				}
				return;
			}

			if (runningTaskIds.size > 0) {
				return;
			}

			const currentStage = status.stages?.find((stage) => stage.stage === currentStageId);
			if (!currentStage) {
				return;
			}

			if (currentStage.completedTaskCount !== currentStage.taskCount) {
				return;
			}

			const deliveryGate = await loadedMission.mission.evaluateGate('deliver');
			if (deliveryGate.allowed) {
				await loadedMission.mission.deliver();
			}
			return;
		}

		throw new Error('Mission autopilot exceeded its progress guard without settling.');
	}

	private async launchAutopilotTaskSession(
		loadedMission: LoadedMission,
		status: OperatorStatus,
		taskId: string
	): Promise<void> {
		const task = this.findTaskState(status, taskId);
		if (!task) {
			return;
		}

		await loadedMission.mission.launchAgentSession({
			runnerId: this.resolveRunnerId(),
			taskId,
			workingDirectory: this.resolveAutopilotWorkingDirectory(status),
			prompt: buildMissionTaskLaunchPrompt(task, this.resolveAutopilotWorkingDirectory(status)),
			title: task.subject,
			operatorIntent: 'Complete this mission task autonomously and stop when the task is finished.'
		});
	}

	private resolveAutopilotWorkingDirectory(status: OperatorStatus): string {
		return status.missionDir ?? this.repositoryRoot;
	}

	private findTaskState(status: OperatorStatus, taskId: string): MissionTaskState | undefined {
		for (const stage of status.stages ?? []) {
			const task = stage.tasks.find((candidate) => candidate.taskId === taskId);
			if (task) {
				return task;
			}
		}

		return undefined;
	}

	private isRunningSession(session: MissionAgentSessionRecord): boolean {
		return (
			session.lifecycleState === 'starting' ||
			session.lifecycleState === 'running' ||
			session.lifecycleState === 'awaiting-input'
		);
	}

	public dispose(): void {
		this.terminalSubscription.dispose();
		for (const pending of this.pendingTerminalNotifications.values()) {
			clearTimeout(pending.timer);
		}
		this.pendingTerminalNotifications.clear();
		for (const loadedMission of this.loadedMissions.values()) {
			loadedMission.consoleSubscription.dispose();
			loadedMission.eventSubscription.dispose();
			loadedMission.mission.dispose();
		}
		this.loadedMissions.clear();
	}

	private assertSelectorMatchesLoadedMission(selector: MissionSelector, loadedMission: LoadedMission): void {
		if (!this.selectorMatchesLoadedMission(selector, loadedMission)) {
			throw new Error(
				selector.missionId
					? `Mission selector '${selector.missionId}' does not match loaded mission '${loadedMission.missionId}'.`
					: `Mission selector does not match loaded mission '${loadedMission.missionId}'.`
			);
		}
	}

	private selectorMatchesLoadedMission(selector: MissionSelector, loadedMission: LoadedMission): boolean {
		if (selector.missionId && selector.missionId !== loadedMission.missionId) {
			return false;
		}

		if (selector.branchRef && selector.branchRef !== loadedMission.branchRef) {
			return false;
		}

		if (
			selector.issueId !== undefined &&
			loadedMission.mission.getRecord().brief.issueId !== selector.issueId
		) {
			return false;
		}

		return true;
	}

	private isLoadedMissionActive(loadedMission: LoadedMission): boolean {
		return this.loadedMissions.get(loadedMission.missionId) === loadedMission;
	}

	private findLoadedMissionForSession(sessionId: string): LoadedMission | undefined {
		for (const loadedMission of this.loadedMissions.values()) {
			if (sessionId === this.getMissionTerminalSessionId(
				this.store.getMissionWorkspacePath(loadedMission.mission.getMissionDir()),
				loadedMission.missionId
			)) {
				return loadedMission;
			}
			if (this.findMissionAgentSessionByTerminalSessionName(loadedMission, sessionId)) {
				return loadedMission;
			}
		}
		return undefined;
	}

	private resolveTerminalEventSessionId(
		loadedMission: LoadedMission,
		terminalSessionName: string
	): string {
		return this.findMissionAgentSessionByTerminalSessionName(loadedMission, terminalSessionName)?.sessionId
			?? terminalSessionName;
	}

	private findMissionAgentSessionByTerminalSessionName(
		loadedMission: LoadedMission,
		sessionIdOrTerminalName: string
	): MissionAgentSessionRecord | undefined {
		const directSession = loadedMission.mission.getAgentSession(sessionIdOrTerminalName);
		if (directSession) {
			return directSession;
		}
		return loadedMission.mission.getAgentSessions().find(
			(candidate) => candidate.terminalSessionName === sessionIdOrTerminalName,
		);
	}

	private toAgentTerminalState(
		sessionId: string,
		snapshot?: TerminalSessionSnapshot
	): MissionAgentTerminalState {
		if (!snapshot) {
			return {
				sessionId,
				connected: false,
				dead: true,
				exitCode: null,
				screen: ''
			};
		}

		return {
			sessionId,
			connected: snapshot.connected,
			dead: snapshot.dead,
			exitCode: snapshot.exitCode,
			screen: snapshot.screen,
			...(snapshot.truncated ? { truncated: true } : {}),
			...(snapshot.chunk !== undefined ? { chunk: snapshot.chunk } : {}),
			terminalHandle: {
				sessionName: snapshot.sessionName,
				paneId: snapshot.paneId,
				...(snapshot.sharedSessionName ? { sharedSessionName: snapshot.sharedSessionName } : {})
			}
		};
	}

	private toAgentTerminalEventState(
		sessionId: string,
		snapshot?: TerminalSessionSnapshot
	): MissionAgentTerminalState {
		const state = this.toAgentTerminalState(sessionId, snapshot);
		return {
			...state,
			screen: ''
		};
	}

	private resolveRunnerId(runnerId?: string): string {
		if (runnerId) {
			return this.requireRunner(runnerId).id;
		}

		const configuredRunnerId = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.repositoryRoot) ?? {}
		).agentRunner;
		if (configuredRunnerId) {
			return this.requireRunner(configuredRunnerId).id;
		}

		const defaultRunnerId = this.agentRunners.keys().next().value;
		if (!defaultRunnerId) {
			throw new Error('No mission agent runners are configured in the server.');
		}

		return defaultRunnerId;
	}

	private requireRunner(runnerId: string): AgentRunner {
		const runner = this.agentRunners.get(runnerId);
		if (!runner) {
			throw new Error(`Mission agent runner '${runnerId}' is not registered in the server.`);
		}
		return runner;
	}

	private toSessionPhaseNotification(
		missionId: string,
		event: MissionAgentEvent
	): Notification | undefined {
		switch (event.type) {
			case 'session-started':
			case 'session-resumed':
				return {
					type: 'session.lifecycle',
					missionId,
					sessionId: event.state.sessionId,
					phase: 'spawned',
					lifecycleState: event.state.lifecycleState
				};
			case 'session-state-changed':
				if (
					event.state.lifecycleState === 'running' ||
					event.state.lifecycleState === 'awaiting-input'
				) {
					return {
						type: 'session.lifecycle',
						missionId,
						sessionId: event.state.sessionId,
						phase: 'active',
						lifecycleState: event.state.lifecycleState
					};
				}
				return undefined;
			case 'session-completed':
			case 'session-failed':
			case 'session-cancelled':
				return {
					type: 'session.lifecycle',
					missionId,
					sessionId: event.state.sessionId,
					phase: 'terminated',
					lifecycleState: event.state.lifecycleState
				};
			default:
				return undefined;
		}
	}

}

function resolveMissionTerminalCommand(): string {
	if (process.platform === 'win32') {
		return process.env['MISSION_TERMINAL_SHELL']?.trim() || 'powershell.exe';
	}

	return process.env['MISSION_TERMINAL_SHELL']?.trim() || process.env['SHELL']?.trim() || 'bash';
}

function resolveMissionTerminalArgs(): string[] {
	if (process.platform === 'win32') {
		return ['-NoLogo'];
	}

	return ['-l'];
}

function buildMissionTerminalEnv(): NodeJS.ProcessEnv {
	const ghBinary = getMissionGitHubCliBinary();
	const pathKey = resolveProcessPathKey(process.env);
	const ghBinaryDirectory = ghBinary ? resolveBinaryParentDirectory(ghBinary) : undefined;
	const nextPath = ghBinaryDirectory && pathKey
		? prependPathEntry(process.env[pathKey], ghBinaryDirectory)
		: undefined;

	return {
		...process.env,
		...(pathKey && nextPath ? { [pathKey]: nextPath } : {}),
		TERM_PROGRAM: 'mission-airport',
		TERM_PROGRAM_VERSION: '1'
	};
}

function resolveProcessPathKey(env: NodeJS.ProcessEnv): string | undefined {
	if (process.platform === 'win32') {
		return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
	}

	return 'PATH';
}

function resolveBinaryParentDirectory(binaryPath: string): string | undefined {
	const trimmedPath = binaryPath.trim();
	if (!trimmedPath) {
		return undefined;
	}

	if (!/[\\/]/u.test(trimmedPath) && trimmedPath !== '.' && trimmedPath !== '..') {
		return undefined;
	}

	const parentDirectory = path.dirname(trimmedPath);
	return parentDirectory === '.' ? undefined : parentDirectory;
}

function prependPathEntry(currentPath: string | undefined, entry: string): string {
	const normalizedEntry = entry.trim();
	if (!normalizedEntry) {
		return currentPath ?? '';
	}

	const parts = (currentPath ?? '')
		.split(path.delimiter)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
	if (parts.includes(normalizedEntry)) {
		return currentPath ?? normalizedEntry;
	}

	return [normalizedEntry, ...parts].join(path.delimiter);
}

function shouldBroadcastMissionStatusForAgentEvent(event: MissionAgentEvent): boolean {
	switch (event.type) {
		case 'session-started':
		case 'session-resumed':
		case 'session-state-changed':
		case 'session-completed':
		case 'session-failed':
		case 'session-cancelled':
			return true;
		default:
			return false;
	}
}

function shouldScheduleAutopilotForAgentEvent(event: MissionAgentEvent): boolean {
	switch (event.type) {
		case 'session-completed':
		case 'session-failed':
		case 'session-cancelled':
			return true;
		default:
			return false;
	}
}

const REPOSITORY_MISSION_COMMAND_DEFINITIONS: readonly RepositoryCommandDefinition[] = [
	{
		id: 'mission.pull-origin',
		label: 'Pull Origin',
		action: '/mission pull-origin',
		ui: {
			toolbarLabel: 'PULL ORIGIN',
			requiresConfirmation: true,
			confirmationPrompt: 'Fast-forward this mission worktree from origin now?'
		},
		evaluate: (context) => {
			const repositorySync = context.repositorySync;
			if (!repositorySync) {
				return { enabled: false, reason: 'Repository sync state is not available for this mission.' };
			}
			if (repositorySync.worktreeClean === false) {
				return { enabled: false, reason: 'Mission worktree has local changes. Commit, stash, or discard them before pulling origin.' };
			}
			switch (repositorySync.status) {
				case 'behind':
					return { enabled: true };
				case 'diverged':
					return { enabled: false, reason: 'Mission branch has diverged from origin and cannot be fast-forwarded.' };
				case 'ahead':
					return { enabled: false, reason: 'Mission branch is already ahead of origin.' };
				case 'up-to-date':
					return { enabled: false, reason: 'Mission worktree is already up to date with origin.' };
				case 'untracked':
					return { enabled: false, reason: 'Origin does not have a tracked branch for this mission yet.' };
				case 'unsupported':
					return { enabled: false, reason: repositorySync.reason ?? 'GitHub tracking is not configured for this mission repository.' };
				case 'error':
					return { enabled: false, reason: repositorySync.reason ?? 'Mission could not determine repository sync state.' };
			}
		}
	},
	{
		id: 'mission.changeset.add',
		label: 'Add Changeset',
		action: '/mission changeset',
		ui: {
			toolbarLabel: 'ADD CHANGESET'
		},
		evaluate: (context) => {
			if (hasReachedDeliveryStage(context)) {
				return { enabled: true };
			}
			return { enabled: false, reason: 'Changesets become available when the mission reaches the DELIVERY stage.' };
		},
		buildFlow: async (workspace) => workspace.buildMissionChangesetFlow()
	}
];

function buildRepositoryMissionCommandDescriptor(
	definition: RepositoryCommandDefinition,
	context: RepositoryCommandContext,
	evaluation: RepositoryCommandRuleResult,
	flow?: OperatorActionFlowDescriptor
): OperatorActionDescriptor {
	return {
		id: definition.id,
		label: definition.label,
		action: definition.action,
		scope: 'mission',
		disabled: !evaluation.enabled,
		disabledReason: evaluation.enabled ? '' : (evaluation.reason ?? 'Action is unavailable.'),
		enabled: evaluation.enabled,
		...(evaluation.enabled ? {} : { reason: evaluation.reason ?? 'Action is unavailable.' }),
		...(definition.ordering ? { ordering: definition.ordering } : {}),
		ui: definition.ui,
		flow: flow ?? {
			targetLabel: 'MISSION',
			actionLabel: definition.ui.toolbarLabel ?? definition.label.toUpperCase(),
			steps: []
		},
		presentationTargets: buildRepositoryMissionPresentationTargets(context.currentStageId)
	};
}

function buildRepositoryMissionPresentationTargets(currentStageId: MissionStageId | undefined) {
	return currentStageId
		? [{ scope: 'mission' as const }, { scope: 'stage' as const, targetId: currentStageId }]
		: [{ scope: 'mission' as const }];
}

function hasReachedDeliveryStage(context: RepositoryCommandContext): boolean {
	return context.currentStageId === 'delivery'
		|| context.missionStatus.stage === 'delivery'
		|| context.missionStatus.workflow?.lifecycle === 'delivered';
}

function createChangesetFileSlug(missionId: string, summary: string): string {
	const summarySlug = summary
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);
	const missionSlug = missionId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24);
	const suffix = Date.now().toString(36);
	return [missionSlug || 'mission', summarySlug || 'changeset', suffix].join('-');
}

function asChangesetReleaseType(value: string | undefined): 'patch' | 'minor' | 'major' | undefined {
	if (value === 'patch' || value === 'minor' || value === 'major') {
		return value;
	}
	return undefined;
}

function normalizeMissionSelector(selector: MissionSelector = {}): MissionSelector {
	const missionId = selector.missionId?.trim();
	const branchRef = selector.branchRef?.trim();
	return {
		...(missionId ? { missionId } : {}),
		...(selector.issueId !== undefined ? { issueId: selector.issueId } : {}),
		...(branchRef ? { branchRef } : {})
	};
}

function hasMissionSelector(selector: MissionSelector): boolean {
	return Boolean(selector.missionId?.trim() || selector.issueId !== undefined || selector.branchRef?.trim());
}

function isMissionSelectorRecord(value: unknown): value is MissionSelector {
	return Boolean(value && typeof value === 'object');
}

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

function requireSelectionActionStep(
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
	if (step.optionIds.every((optionId) => !optionId.trim())) {
		throw new Error(`Mission action requires at least one selection for step '${stepId}'.`);
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

const CHANGESET_RELEASE_TYPE_OPTIONS: OperatorActionFlowOption[] = [
	{
		id: 'patch',
		label: 'Patch',
		description: 'Use for fixes and small compatible updates.'
	},
	{
		id: 'minor',
		label: 'Minor',
		description: 'Use for backward-compatible features.'
	},
	{
		id: 'major',
		label: 'Major',
		description: 'Use for breaking changes.'
	}
];

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
