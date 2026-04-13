import type { AirportProjectionSet, AirportState, PersistedAirportIntent } from '../../airport/build/index.js';
import type { MissionAgentSessionRecord } from './daemon/protocol/contracts.js';
import type { MissionDaemonSettings } from './lib/daemonConfig.js';
import { MISSION_STAGE_IDS, type MissionStageId } from './workflow/stages.js';
import {
	MissionGateProjection,
	MISSION_AGENT_SESSION_LIFECYCLE_STATES,
	MISSION_LIFECYCLE_STATES,
	MISSION_STAGE_DERIVED_STATES,
	MISSION_TASK_LIFECYCLE_STATES,
	type MissionAgentSessionLifecycleState,
	type MissionLifecycleState,
	MissionPanicState,
	MissionPauseState,
	type MissionStageDerivedState,
	MissionStageRuntimeProjection,
	type MissionTaskLifecycleState,
	type MissionTaskRuntimeState,
	type MissionWorkflowConfigurationSnapshot
} from './workflow/engine/types.js';
import {
	MISSION_ARTIFACT_KEYS,
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_STAGE_FOLDERS,
	getMissionArtifactDefinition,
	getMissionStageDefinition,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getMissionTaskPairingDefinition,
	isMissionArtifactKey,
	isMissionStageId,
	isMissionStageProgress,
	type MissionArtifactKey,
	type MissionTaskPairingDefinition,
	type MissionStageProgress,
	type MissionTaskStatusIntent,
	type MissionWorkflowTaskStatus
} from './workflow/manifest.js';

export {
	MISSION_AGENT_SESSION_LIFECYCLE_STATES,
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_LIFECYCLE_STATES,
	MISSION_STAGE_IDS,
	MISSION_STAGE_DERIVED_STATES,
	MISSION_STAGES,
	MISSION_STAGE_FOLDERS,
	MISSION_TASK_LIFECYCLE_STATES,
	getMissionArtifactDefinition,
	getMissionStageDefinition,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getMissionTaskPairingDefinition,
	isMissionArtifactKey,
	isMissionStageId,
	isMissionStageProgress
};

export type {
	MissionArtifactKey,
	MissionAgentSessionLifecycleState,
	MissionLifecycleState,
	MissionStageId,
	MissionStageDerivedState,
	MissionStageProgress,
	MissionTaskLifecycleState,
	MissionTaskPairingDefinition,
	MissionTaskStatusIntent,
	MissionWorkflowTaskStatus
};

export type MissionProductKey = MissionArtifactKey;

export const MISSION_RUNTIME_FILE_NAME = 'mission.json';

export const MISSION_ARTIFACT_FILE_NAMES: string[] = MISSION_ARTIFACT_KEYS.map(
	(artifactKey) => MISSION_ARTIFACTS[artifactKey]
);
export const MISSION_TRACKED_FILE_NAMES: string[] = [...MISSION_ARTIFACT_FILE_NAMES];

export type GateIntent = 'implement' | 'commit' | 'verify' | 'audit' | 'deliver';

export const MISSION_GATE_INTENTS: GateIntent[] = [
	'implement',
	'commit',
	'verify',
	'audit',
	'deliver'
];

export type MissionType = 'feature' | 'fix' | 'docs' | 'refactor' | 'task';
export type MissionTaskStatus = MissionTaskLifecycleState;
export type MissionTaskAgent = string;

export type OperatorActionScope = 'mission' | 'task' | 'session' | 'generation';
export type OperatorActionFlowSelectionMode = 'single' | 'multiple';
export type OperatorActionFlowTextMode = 'compact' | 'expanded';
export type OperatorActionFlowTextFormat = 'plain' | 'markdown';

export type OperatorActionFlowOption = {
	id: string;
	label: string;
	description: string;
};

export type OperatorActionFlowSelectionStep = {
	kind: 'selection';
	id: string;
	label: string;
	title: string;
	emptyLabel: string;
	helperText: string;
	selectionMode: OperatorActionFlowSelectionMode;
	options: OperatorActionFlowOption[];
};

export type OperatorActionFlowTextStep = {
	kind: 'text';
	id: string;
	label: string;
	title: string;
	helperText: string;
	placeholder: string;
	initialValue?: string;
	inputMode: OperatorActionFlowTextMode;
	format: OperatorActionFlowTextFormat;
};

export type OperatorActionFlowStep = OperatorActionFlowSelectionStep | OperatorActionFlowTextStep;

export type OperatorActionFlowDescriptor = {
	targetLabel: string;
	actionLabel: string;
	steps: OperatorActionFlowStep[];
};

export type OperatorActionUiMetadata = {
	toolbarLabel?: string;
	requiresConfirmation?: boolean;
	confirmationPrompt?: string;
};

export type OperatorActionPresentationScope = 'mission' | 'stage' | 'task' | 'session';

export type OperatorActionPresentationTarget = {
	scope: OperatorActionPresentationScope;
	targetId?: string;
};

export type OperatorActionTargetContext = {
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
};

export type OperatorActionQueryContext = OperatorActionTargetContext;

export type OperatorActionExecutionMetadata = {
	stageId?: MissionStageId;
	autostart?: boolean;
	batchTargetIds?: string[];
};

export type OperatorActionOrderingMetadata = {
	group?: 'default' | 'recovery';
};

// A daemon action is the canonical operator operation exposed by Mission.
// It is source-owned data produced by the daemon after applying runtime rules,
// target context, workflow policy, and action ordering policy. Tower should
// render and invoke these descriptors, not invent new business operations,
// filtering rules, or ranking logic locally.
export type OperatorActionDescriptor = {
	id: string;
	label: string;
	// Human-entered slash text that maps to this action when typed in Tower,
	// for example `/mission resume` or `/task start`.
	// This is a presentation string, not the canonical identity.
	action: string;
	scope: OperatorActionScope;
	targetId?: string;
	disabled: boolean;
	disabledReason: string;
	enabled: boolean;
	reason?: string;
	flow?: OperatorActionFlowDescriptor;
	ui?: OperatorActionUiMetadata;
	presentationTargets?: OperatorActionPresentationTarget[];
	metadata?: OperatorActionExecutionMetadata;
	ordering?: OperatorActionOrderingMetadata;
};

export type OperatorActionExecutionSelectionStep = {
	kind: 'selection';
	stepId: string;
	optionIds: string[];
};

export type OperatorActionExecutionTextStep = {
	kind: 'text';
	stepId: string;
	value: string;
};

export type OperatorActionExecutionStep =
	| OperatorActionExecutionSelectionStep
	| OperatorActionExecutionTextStep;

// Terminology:
// - action: daemon-defined operator operation identified by OperatorActionDescriptor.id
// - action text: the slash-text alias in OperatorActionDescriptor.action used for typing/search
// - command: UI term for typed operator input or picker rows derived from actions
// - session command: normalized provider command sent through `session.command`; not the same as an operator action
//
// Ownership:
// - daemon: constructs actions, applies availability rules, filters by target context,
//   and orders actions for presentation
// - Tower: renders the daemon-provided list, preserves daemon order, and may only
//   narrow the visible set through local query text matching

export type MissionBrief = {
	issueId?: number;
	title: string;
	body: string;
	type: MissionType;
	url?: string;
	labels?: string[];
	metadata?: Record<string, string>;
};

export type TrackedIssueSummary = {
	number: number;
	title: string;
	url: string;
	updatedAt?: string;
	labels: string[];
	assignees: string[];
};

export type MissionSelector = {
	missionId?: string;
	issueId?: number;
	branchRef?: string;
};

export type MissionDescriptor = {
	missionId: string;
	brief: MissionBrief;
	missionDir: string;
	branchRef: string;
	createdAt: string;
	deliveredAt?: string;
};

export type MissionRecord = {
	id: string;
	brief: MissionBrief;
	missionDir: string;
	missionRootDir?: string;
	branchRef: string;
	createdAt: string;
	stage: MissionStageId;
	deliveredAt?: string;
	agentSessions: MissionAgentSessionRecord[];
};

export type MissionGateResult = {
	allowed: boolean;
	intent: GateIntent;
	stage?: MissionStageId;
	errors: string[];
	warnings: string[];
};

export type MissionTaskState = {
	taskId: string;
	stage: MissionStageId;
	sequence: number;
	subject: string;
	instruction: string;
	body: string;
	dependsOn: string[];
	blockedBy: string[];
	status: MissionTaskStatus;
	agent: MissionTaskAgent;
	retries: number;
	fileName: string;
	filePath: string;
	relativePath: string;
};

export type TaskData = MissionTaskState;

export type MissionTaskUpdate = Partial<Pick<MissionTaskState, 'status' | 'agent' | 'retries'>>;

export type MissionStageStatus = {
	stage: MissionStageId;
	folderName: string;
	status: MissionStageDerivedState;
	taskCount: number;
	completedTaskCount: number;
	activeTaskIds: string[];
	readyTaskIds: string[];
	tasks: MissionTaskState[];
};

export type MissionSelectionCandidate = {
	missionId: string;
	title: string;
	branchRef: string;
	createdAt: string;
	issueId?: number;
};

export type MissionRepositoryCandidate = {
	repositoryRootPath: string;
	label: string;
	description: string;
	githubRepository?: string;
};

export type MissionPreparationStatus =
	| {
		kind: 'repository-bootstrap';
		state: 'pull-request-opened';
		branchRef: string;
		baseBranch: string;
		pullRequestUrl: string;
		controlDirectoryPath: string;
		settingsPath: string;
		worktreesPath: string;
		missionsPath: string;
	}
	| {
		kind: 'mission';
		state: 'branch-prepared';
		missionId: string;
		branchRef: string;
		baseBranch: string;
		worktreePath: string;
		missionRootDir: string;
		issueId?: number;
		issueUrl?: string;
	};

export type MissionOperationalMode = 'setup' | 'root' | 'mission';

export type ContextSelection = {
	repositoryId?: string;
	missionId?: string;
	stageId?: MissionStageId;
	taskId?: string;
	artifactId?: string;
	agentSessionId?: string;
};

export type RepositoryContext = {
	repositoryId: string;
	rootPath: string;
	displayLabel: string;
	missionIds: string[];
	workflowSettingsId?: string;
};

export type MissionContext = {
	missionId: string;
	repositoryId: string;
	briefSummary: string;
	issueId?: number;
	branchRef?: string;
	createdAt?: string;
	workspacePath: string;
	currentStage?: MissionStageId;
	lifecycleState?: MissionLifecycleState;
	taskIds: string[];
	artifactIds: string[];
	sessionIds: string[];
};

export type MissionOperatorProjectionContext = {
	missionId: string;
	stageRail: MissionTowerStageRailItem[];
	treeNodes: MissionTowerTreeNode[];
};

export type TaskContext = {
	taskId: string;
	missionId?: string;
	stageId: MissionStageId;
	subject: string;
	instructionSummary: string;
	lifecycleState: MissionTaskStatus;
	dependencyIds: string[];
	primaryArtifactId?: string;
	agentSessionIds?: string[];
};

export type ArtifactContext = {
	artifactId: string;
	missionId?: string;
	repositoryId?: string;
	ownerTaskId?: string;
	filePath: string;
	logicalKind: string;
	displayLabel: string;
};

export type AgentSessionContext = {
	sessionId: string;
	missionId?: string;
	taskId?: string;
	workingDirectory?: string;
	runnerId: string;
	lifecycleState: string;
	promptTitle?: string;
	transportId?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
	createdAt?: string;
	lastUpdatedAt?: string;
};

export type ContextGraph = {
	selection: ContextSelection;
	repositories: Record<string, RepositoryContext>;
	missions: Record<string, MissionContext>;
	tasks: Record<string, TaskContext>;
	artifacts: Record<string, ArtifactContext>;
	agentSessions: Record<string, AgentSessionContext>;
};

export type MissionSystemState = {
	version: number;
	domain: ContextGraph;
	missionOperatorViews: Record<string, MissionOperatorProjectionContext>;
	airport: AirportState;
	airports: {
		activeRepositoryId?: string;
		repositories: Record<string, {
			repositoryId: string;
			repositoryRootPath: string;
			airport: AirportState;
			persistedIntent: PersistedAirportIntent;
		}>;
	};
};

export type MissionSystemSnapshot = {
	state: MissionSystemState;
	airportProjections: AirportProjectionSet;
	airportRegistryProjections: Record<string, AirportProjectionSet>;
};

export type MissionControlPlaneStatus = {
	controlRoot: string;
	missionDirectory: string;
	settingsPath: string;
	worktreesPath: string;
	currentBranch?: string;
	settings: MissionDaemonSettings;
	isGitRepository: boolean;
	initialized: boolean;
	settingsPresent: boolean;
	settingsComplete: boolean;
	trackingProvider?: 'github';
	githubRepository?: string;
	issuesConfigured: boolean;
	githubAuthenticated?: boolean;
	githubUser?: string;
	githubAuthMessage?: string;
	availableMissionCount: number;
	problems: string[];
	warnings: string[];
};

export type StageData = MissionStageStatus;

export type MissionTowerStageRailItemState = MissionStageDerivedState;

export type MissionTowerStageRailItem = {
	id: string;
	label: string;
	state: MissionTowerStageRailItemState;
	subtitle?: string;
};

export type MissionTowerTreeNodeKind = 'stage' | 'stage-artifact' | 'task' | 'task-artifact' | 'session';

export type MissionTowerTreeNode = {
	id: string;
	label: string;
	kind: MissionTowerTreeNodeKind;
	depth: number;
	color: string;
	statusLabel?: string;
	collapsible: boolean;
	sourcePath?: string;
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
};

export type MissionSelectionTarget = {
	kind: MissionTowerTreeNodeKind;
	label?: string;
	sourcePath?: string;
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
};

export type MissionResolvedSelection = {
	missionId?: string;
	stageId?: MissionStageId;
	taskId?: string;
	activeInstructionArtifactId?: string;
	activeInstructionPath?: string;
	activeStageResultArtifactId?: string;
	activeStageResultPath?: string;
	activeAgentSessionId?: string;
};

export type MissionTowerProjection = {
	stageRail: MissionTowerStageRailItem[];
	treeNodes: MissionTowerTreeNode[];
};

export type OperatorStatus = {
	found: boolean;
	operationalMode?: MissionOperationalMode;
	control?: MissionControlPlaneStatus;
	system?: MissionSystemSnapshot;
	missionId?: string;
	title?: string;
	issueId?: number;
	type?: MissionType;
	stage?: MissionStageId;
	branchRef?: string;
	missionDir?: string;
	missionRootDir?: string;
	productFiles?: Partial<Record<MissionArtifactKey, string>>;
	activeTasks?: MissionTaskState[];
	readyTasks?: MissionTaskState[];
	stages?: MissionStageStatus[];
	agentSessions?: MissionAgentSessionRecord[];
	tower?: MissionTowerProjection;
	workflow?: {
		lifecycle: MissionLifecycleState;
		pause: MissionPauseState;
		panic: MissionPanicState;
		currentStageId?: MissionStageId;
		configuration: MissionWorkflowConfigurationSnapshot;
		stages: MissionStageRuntimeProjection[];
		tasks: MissionTaskRuntimeState[];
		gates: MissionGateProjection[];
		updatedAt: string;
	};
	recommendedAction?: string;
	availableMissions?: MissionSelectionCandidate[];
	availableRepositories?: MissionRepositoryCandidate[];
	preparation?: MissionPreparationStatus;
};

export type OperatorData = OperatorStatus;

export function isMissionTaskStatus(value: unknown): value is MissionTaskStatus {
	return typeof value === 'string'
		&& (MISSION_TASK_LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function isMissionTaskAgent(value: unknown): value is MissionTaskAgent {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isGateIntent(value: unknown): value is GateIntent {
	return typeof value === 'string' && (MISSION_GATE_INTENTS as readonly string[]).includes(value);
}
