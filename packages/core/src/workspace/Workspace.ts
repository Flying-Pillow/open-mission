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
	GitHubPlatformAdapter,
	resolveGitHubRepositoryFromWorkspace
} from '../platforms/GitHubPlatformAdapter.js';
import {
	type MissionAgentDisposable
} from '../agent/events.js';
import {
	getMissionDirectoryPath,
	getMissionWorktreesPath,
} from '../lib/repoConfig.js';
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
	MissionControlPlaneStatus,
	MissionOperationalMode,
	MissionSelectionCandidate,
	MissionTaskState,
	MissionSelector,
	OperatorStatus
} from '../types.js';
import type { MissionControlSource } from '../daemon/control-plane/types.js';
import {
	type ControlActionList,
	type ControlActionDescribe,
	type ControlActionExecute,
	type ControlDocumentRead,
	type ControlDocumentResponse,
	type ControlDocumentWrite,
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
	type MissionAgentEvent,
	type MissionAgentSessionRecord,
	type MissionSelect,
	type Notification,
	type Request,
	type SessionCommand,
	type SessionConsoleState,
	type SessionControl,
	type SessionPrompt
} from '../daemon/protocol/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../agent/AgentRuntimeTypes.js';
import type { AgentRunner } from '../agent/AgentRunner.js';
import { createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';
import { readSystemStatus } from '../system/SystemStatus.js';
import {
	WorkflowSettingsStore,
	type WorkflowSettingsGetResult
} from '../settings/index.js';

type LoadedMission = {
	missionId: string;
	branchRef: string;
	mission: Mission;
	consoleSubscription: MissionAgentDisposable;
	eventSubscription: MissionAgentDisposable;
	autopilotEnabled: boolean;
	autopilotQueue: Promise<void>;
};
export class MissionWorkspace {
	private readonly store: FilesystemAdapter;
	private readonly workflowSettingsStore: WorkflowSettingsStore;
	private readonly agentRunners = new Map<string, AgentRunner>();
	private readonly loadedMissions = new Map<string, LoadedMission>();

	public constructor(
		private readonly workspaceRoot: string,
		agentRunners: Map<string, AgentRunner>,
		private readonly emitEvent: (event: Notification) => void
	) {
		this.store = new FilesystemAdapter(workspaceRoot);
		this.workflowSettingsStore = new WorkflowSettingsStore(workspaceRoot);
		for (const [runnerId, runner] of agentRunners) {
			this.agentRunners.set(runnerId, runner);
		}
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
			case 'mission.from-issue':
				return this.createMissionFromIssue((request.params ?? {}) as MissionFromIssueRequest);
			case 'mission.from-brief':
				return this.createMissionFromBrief((request.params ?? {}) as MissionFromBriefRequest);
			case 'control.action.list':
				return this.listControlActions((request.params ?? {}) as ControlActionList);
			case 'control.action.describe':
				return this.describeControlAction((request.params ?? {}) as ControlActionDescribe);
			case 'control.action.execute':
				return this.executeControlAction((request.params ?? {}) as ControlActionExecute);
			case 'mission.status':
				return this.getMissionStatus(this.toMissionParams(request.params));
			case 'mission.action.list':
				return this.listMissionActions((request.params ?? {}) as MissionActionList);
			case 'mission.action.execute':
				return this.executeMissionAction((request.params ?? {}) as MissionActionExecute);
			case 'mission.gate.evaluate':
				return this.evaluateGate((request.params ?? {}) as MissionGateEvaluate);
			case 'session.list':
				return this.listAgentSessions((request.params ?? {}) as MissionSelect);
			case 'session.console.state':
				return this.getAgentConsoleState((request.params ?? {}) as SessionConsoleState);
			case 'session.prompt':
				return this.promptAgentSession((request.params ?? {}) as SessionPrompt);
			case 'session.command':
				return this.commandAgentSession((request.params ?? {}) as SessionCommand);
			case 'session.cancel':
				return this.cancelAgentSession((request.params ?? {}) as SessionControl);
			case 'session.terminate':
				return this.terminateAgentSession((request.params ?? {}) as SessionControl);
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

	public async buildDiscoveryStatus(
		availableMissions: MissionSelectionCandidate[],
		availableRepositories: MissionControlSource['availableRepositories'] = []
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

	public async readMissionControlSource(input: {
		availableRepositories?: MissionControlSource['availableRepositories'];
		selectedMissionId?: string;
		missionStatusHint?: OperatorStatus;
	} = {}): Promise<MissionControlSource> {
		const availableMissions = await this.listMissionSelectionCandidates();
		const discoveryStatus = await this.buildDiscoveryStatus(availableMissions, input.availableRepositories ?? []);
		const selectedMissionId = input.selectedMissionId?.trim();
		const hintedMissionStatus = input.missionStatusHint?.missionId?.trim()
			&& input.missionStatusHint.missionId.trim() === selectedMissionId
			? input.missionStatusHint
			: undefined;
		const missionStatus = hintedMissionStatus
			?? (selectedMissionId
				? await this.getMissionStatus({ selector: { missionId: selectedMissionId } }).catch(() => undefined)
				: undefined);
		return {
			repositoryId: this.workspaceRoot,
			repositoryRootPath: this.workspaceRoot,
			control: discoveryStatus.control!,
			availableRepositories: input.availableRepositories ?? [],
			availableMissions,
			...(missionStatus ? { missionStatus } : {})
		};
	}

	private buildDiscoveryAvailableActions(
		control: MissionControlPlaneStatus,
		availableMissions: MissionSelectionCandidate[]
	): OperatorActionDescriptor[] {
		return [
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
				flow: this.buildMissionSwitchFlow(availableMissions),
				...(availableMissions.length > 0 ? {} : { reason: 'No local missions are available.' })
			}
		];
	}

	private async executeControlAction(params: ControlActionExecute): Promise<OperatorStatus> {
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

		throw new Error(`Unsupported control action '${params.actionId}'.`);
	}

	private async listControlActions(params: ControlActionList = {}): Promise<OperatorActionListSnapshot> {
		const availableMissions = await this.listMissionSelectionCandidates();
		const control = await this.buildControlPlaneStatus(availableMissions.length);
		return {
			actions: this.resolveAvailableActions(this.buildDiscoveryAvailableActions(control, availableMissions), params.context),
			revision: this.buildControlActionRevision(control)
		};
	}

	private async executeMissionAction(params: MissionActionExecute): Promise<OperatorStatus> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const status = await loadedMission.mission.executeAction(params.actionId, params.steps ?? [], {
			...(params.terminalSessionName?.trim() ? { terminalSessionName: params.terminalSessionName.trim() } : {})
		});
		await this.broadcastMissionStatus(loadedMission.missionId, status);
		return this.decorateMissionStatus(status, 'mission');
	}

	private async listMissionActions(params: MissionActionList): Promise<OperatorActionListSnapshot> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const snapshot = await loadedMission.mission.listAvailableActionsSnapshot();
		return {
			actions: this.resolveAvailableActions(snapshot.actions, params.context),
			revision: snapshot.revision
		};
	}

	private async createMissionFromBrief(params: MissionFromBriefRequest): Promise<OperatorStatus> {
		const githubRepository = this.requireGitHubRepository();
		this.requireGitHubAuthentication();

		const github = new GitHubPlatformAdapter(this.workspaceRoot, githubRepository);
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
			throw new Error('Mission preparation returned a repository bootstrap result unexpectedly.');
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
			missionRootDir: preparation.missionRootDir
		};
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
		params: MissionFromIssueRequest
	): Promise<OperatorStatus> {
		const githubRepository = this.requireGitHubRepository();
		this.requireGitHubAuthentication();

		const adapter = new GitHubPlatformAdapter(this.workspaceRoot, githubRepository);
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

	private async broadcastMissionStatus(missionId: string, status: OperatorStatus): Promise<void> {
		const decoratedStatus = await this.decorateMissionStatus(status, 'mission');
		this.emitEvent({
			type: 'mission.status',
			workspaceRoot: this.workspaceRoot,
			missionId,
			status: decoratedStatus
		});
		this.emitEvent({
			type: 'mission.actions.changed',
			workspaceRoot: this.workspaceRoot,
			missionId,
			revision: this.buildMissionActionRevision(missionId, decoratedStatus)
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
			readMissionDaemonSettings(this.workspaceRoot) ?? {}
		);
		const resolveWorkflow = () => {
			const liveSettings = getDefaultMissionDaemonSettingsWithOverrides(
				readMissionDaemonSettings(this.workspaceRoot) ?? {}
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
						: path.join(this.workspaceRoot, settings.instructionsPath)
				}
				: {}),
			...(settings.skillsPath
				? {
					skillsPath: path.isAbsolute(settings.skillsPath)
						? settings.skillsPath
						: path.join(this.workspaceRoot, settings.skillsPath)
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
				fs.access(getMissionDirectoryPath(this.workspaceRoot)),
				fs.access(getMissionDaemonSettingsPath(this.workspaceRoot))
			]);
			return true;
		} catch {
			return false;
		}
	}

	private async buildControlPlaneStatus(
		availableMissionCount?: number
	): Promise<MissionControlPlaneStatus> {
		const settings = readMissionDaemonSettings(this.workspaceRoot);
		const effectiveSettings = getDefaultMissionDaemonSettingsWithOverrides(settings ?? {});
		const githubRepository = effectiveSettings.trackingProvider === 'github'
			? resolveGitHubRepositoryFromWorkspace(this.workspaceRoot)
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
			controlRoot: this.workspaceRoot,
			missionDirectory: getMissionDirectoryPath(this.workspaceRoot),
			settingsPath: getMissionDaemonSettingsPath(this.workspaceRoot),
			worktreesPath: getMissionWorktreesPath(
				this.workspaceRoot,
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

	private resolveOperationalMode(control: MissionControlPlaneStatus): Extract<MissionOperationalMode, 'setup' | 'root'> {
		return control.problems.length > 0 ? 'setup' : 'root';
	}

	private buildControlActionRevision(control: MissionControlPlaneStatus): string {
		return JSON.stringify({
			scope: 'control',
			settingsPath: control.settingsPath,
			settingsComplete: control.settingsComplete,
			availableMissionCount: control.availableMissionCount,
			currentBranch: control.currentBranch ?? null,
			trackingProvider: control.trackingProvider ?? null
		});
	}

	private buildMissionActionRevision(missionId: string, status: OperatorStatus): string {
		const workflowUpdatedAt = status.workflow?.updatedAt?.trim();
		if (workflowUpdatedAt) {
			return `mission:${missionId}:${workflowUpdatedAt}`;
		}
		const systemVersion = status.system?.state.version;
		if (typeof systemVersion === 'number') {
			return `mission:${missionId}:system:${String(systemVersion)}`;
		}
		return `mission:${missionId}:status`;
	}

	private buildSetupCommandFlow(
		control: MissionControlPlaneStatus,
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
		control: MissionControlPlaneStatus
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
		control: MissionControlPlaneStatus,
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
						description: 'Interactive Copilot CLI session in terminal-manager transport'
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
							? 'Terminal-manager transport continues until interrupted or complete'
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
		control: MissionControlPlaneStatus,
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

	private async describeControlAction(
		params: ControlActionDescribe
	): Promise<OperatorActionFlowDescriptor> {
		const control = await this.buildControlPlaneStatus();
		if (params.actionId === 'control.setup.edit') {
			return this.buildSetupCommandFlow(control, params.steps ?? []);
		}
		if (params.actionId === 'control.mission.start') {
			return this.buildMissionStartFlow();
		}
		if (params.actionId === 'control.mission.select') {
			return this.buildMissionSwitchFlow(await this.listMissionSelectionCandidates());
		}
		throw new Error(`Unsupported control action '${params.actionId}'.`);
	}

	private async writeControlSetting(
		field: ControlSettingsUpdate['field'],
		rawValue: string
	): Promise<void> {
		if (!(await this.isRepositoryInitialized())) {
			throw new Error(
				'Repository settings cannot be edited locally until the repository bootstrap PR is merged and pulled.'
			);
		}

		const nextSettings: MissionDaemonSettings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.workspaceRoot) ?? {}
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

		await writeMissionDaemonSettings(nextSettings, this.workspaceRoot);
	}

	private isAutopilotConfigured(): boolean {
		return false;
	}

	private requireGitHubRepository(): string {
		const settings = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.workspaceRoot) ?? {}
		);
		if (settings.trackingProvider !== 'github') {
			throw new Error('Mission authorization requires the GitHub tracking provider.');
		}

		const githubRepository = resolveGitHubRepositoryFromWorkspace(this.workspaceRoot);
		if (!githubRepository) {
			throw new Error('Mission could not resolve a GitHub repository from the current workspace.');
		}

		return githubRepository;
	}

	private requireGitHubAuthentication(): void {
		const systemStatus = readSystemStatus({ cwd: this.workspaceRoot });
		if (!systemStatus.github.authenticated) {
			throw new Error(systemStatus.github.detail ?? 'GitHub CLI authentication is required.');
		}
	}

	private toMissionParams(params: unknown): MissionSelect {
		if (!params || typeof params !== 'object') {
			return {};
		}

		return params as MissionSelect;
	}

	private resolveWorkspaceDocumentPath(filePath: string): string {
		const trimmedPath = filePath.trim();
		if (trimmedPath.length === 0) {
			throw new Error('Document path is required.');
		}
		const resolvedPath = path.resolve(this.workspaceRoot, trimmedPath);
		const relativePath = path.relative(this.workspaceRoot, resolvedPath);
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
			await existingById.mission.refresh();
			return existingById;
		}

		for (const loadedMission of this.loadedMissions.values()) {
			if (!this.selectorMatchesLoadedMission(selector, loadedMission)) {
				continue;
			}

			await loadedMission.mission.refresh();
			return loadedMission;
		}

		return undefined;
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
		void this.broadcastMissionStatusSnapshot(loadedMission);
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
		return status.missionDir ?? this.workspaceRoot;
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

	private resolveRunnerId(runnerId?: string): string {
		if (runnerId) {
			return this.requireRunner(runnerId).id;
		}

		const configuredRunnerId = getDefaultMissionDaemonSettingsWithOverrides(
			readMissionDaemonSettings(this.workspaceRoot) ?? {}
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
