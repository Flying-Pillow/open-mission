import type { AirportProjectionSet, AirportState, PersistedAirportIntent } from '../../airport/build/index.js';
import type { MissionAgentSessionRecord } from './daemon/contracts.js';
import type { MissionDaemonSettings } from './lib/daemonConfig.js';
import type {
	MissionGateProjection,
	MissionLifecycleState,
	MissionPanicState,
	MissionPauseState,
	MissionStageRuntimeProjection,
	MissionTaskLaunchMode,
	MissionTaskRuntimeState,
	MissionWorkflowConfigurationSnapshot
} from './workflow/engine/types.js';
import {
	MISSION_ARTIFACT_KEYS,
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	getMissionArtifactDefinition,
	getMissionStageDefinition,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getMissionTaskPairingDefinition,
	isMissionArtifactKey,
	isMissionStageId,
	isMissionStageProgress,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionTaskPairingDefinition,
	type MissionStageProgress,
	type MissionTaskStatusIntent,
	type MissionWorkflowTaskStatus
} from './workflow/manifest.js';

export {
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
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
	MissionStageId,
	MissionStageProgress,
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
export type MissionTaskStatus = MissionWorkflowTaskStatus;
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

export type OperatorActionExecutionMetadata = {
	stageId?: MissionStageId;
	launchMode?: MissionTaskLaunchMode;
	autostart?: boolean;
	batchTargetIds?: string[];
};

export type OperatorActionDescriptor = {
	id: string;
	label: string;
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
};

export type MissionRecord = {
	id: string;
	brief: MissionBrief;
	missionDir: string;
	missionRootDir?: string;
	missionControlDir?: string;
	branchRef: string;
	createdAt: string;
	stage: MissionStageId;
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
	directoryName: string;
	status: MissionStageProgress;
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
		state: 'pull-request-opened';
		missionId: string;
		branchRef: string;
		baseBranch: string;
		pullRequestUrl: string;
		missionRootDir: string;
		missionControlDir: string;
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
	tower?: MissionTowerProjection;
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
	runtimeId: string;
	lifecycleState: string;
	promptTitle?: string;
	transportId?: string;
};

export type ContextGraph = {
	selection: ContextSelection;
	repositories: Record<string, RepositoryContext>;
	missions: Record<string, MissionContext>;
	tasks: Record<string, TaskContext>;
	artifacts: Record<string, ArtifactContext>;
	agentSessions: Record<string, AgentSessionContext>;
	availableActions: OperatorActionDescriptor[];
};

export type MissionSystemActionProjection = {
	targetContext: OperatorActionTargetContext;
	availableActions: OperatorActionDescriptor[];
};

export type MissionSystemActionProjections = {
	dashboard: MissionSystemActionProjection;
};

export type MissionSystemState = {
	version: number;
	domain: ContextGraph;
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
	actionProjections: MissionSystemActionProjections;
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

export type MissionTowerStageRailItemState = 'done' | 'active' | 'blocked' | 'pending';

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
	collapsible: boolean;
	sourcePath?: string;
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
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
	missionControlDir?: string;
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
	availableActions?: OperatorActionDescriptor[];
	availableMissions?: MissionSelectionCandidate[];
	preparation?: MissionPreparationStatus;
};

export type OperatorData = OperatorStatus;

export function isMissionTaskStatus(value: unknown): value is MissionTaskStatus {
	return value === 'todo' || value === 'active' || value === 'blocked' || value === 'done';
}

export function isMissionTaskAgent(value: unknown): value is MissionTaskAgent {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isGateIntent(value: unknown): value is GateIntent {
	return typeof value === 'string' && (MISSION_GATE_INTENTS as readonly string[]).includes(value);
}
