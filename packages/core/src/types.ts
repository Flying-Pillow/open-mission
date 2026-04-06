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

export type MissionActionScope = 'mission' | 'task' | 'session' | 'generation';
export type MissionActionFlowSelectionMode = 'single' | 'multiple';
export type MissionActionFlowTextMode = 'compact' | 'expanded';
export type MissionActionFlowTextFormat = 'plain' | 'markdown';

export type MissionActionFlowOption = {
	id: string;
	label: string;
	description: string;
};

export type MissionActionFlowSelectionStep = {
	kind: 'selection';
	id: string;
	label: string;
	title: string;
	emptyLabel: string;
	helperText: string;
	selectionMode: MissionActionFlowSelectionMode;
	options: MissionActionFlowOption[];
};

export type MissionActionFlowTextStep = {
	kind: 'text';
	id: string;
	label: string;
	title: string;
	helperText: string;
	placeholder: string;
	initialValue?: string;
	inputMode: MissionActionFlowTextMode;
	format: MissionActionFlowTextFormat;
};

export type MissionActionFlowStep = MissionActionFlowSelectionStep | MissionActionFlowTextStep;

export type MissionActionFlowDescriptor = {
	targetLabel: string;
	actionLabel: string;
	steps: MissionActionFlowStep[];
};

export type MissionActionUiMetadata = {
	toolbarLabel?: string;
	requiresConfirmation?: boolean;
	confirmationPrompt?: string;
};

export type MissionActionPresentationScope = 'mission' | 'stage' | 'task' | 'session';

export type MissionActionPresentationTarget = {
	scope: MissionActionPresentationScope;
	targetId?: string;
};

export type MissionActionExecutionMetadata = {
	stageId?: MissionStageId;
	launchMode?: MissionTaskLaunchMode;
	autostart?: boolean;
	batchTargetIds?: string[];
};

export type MissionActionDescriptor = {
	id: string;
	label: string;
	action: string;
	scope: MissionActionScope;
	targetId?: string;
	disabled: boolean;
	disabledReason: string;
	enabled: boolean;
	reason?: string;
	flow?: MissionActionFlowDescriptor;
	ui?: MissionActionUiMetadata;
	presentationTargets?: MissionActionPresentationTarget[];
	metadata?: MissionActionExecutionMetadata;
};

export type MissionActionExecutionSelectionStep = {
	kind: 'selection';
	stepId: string;
	optionIds: string[];
};

export type MissionActionExecutionTextStep = {
	kind: 'text';
	stepId: string;
	value: string;
};

export type MissionActionExecutionStep =
	| MissionActionExecutionSelectionStep
	| MissionActionExecutionTextStep;

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
	flightDeckDir?: string;
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
		flightDeckDir: string;
		issueId?: number;
		issueUrl?: string;
	};

export type MissionOperationalMode = 'setup' | 'root' | 'mission';

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

export type MissionStatus = {
	found: boolean;
	operationalMode?: MissionOperationalMode;
	control?: MissionControlPlaneStatus;
	missionId?: string;
	title?: string;
	issueId?: number;
	type?: MissionType;
	stage?: MissionStageId;
	branchRef?: string;
	missionDir?: string;
	missionRootDir?: string;
	flightDeckDir?: string;
	productFiles?: Partial<Record<MissionArtifactKey, string>>;
	activeTasks?: MissionTaskState[];
	readyTasks?: MissionTaskState[];
	stages?: MissionStageStatus[];
	agentSessions?: MissionAgentSessionRecord[];
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
	availableActions?: MissionActionDescriptor[];
	availableMissions?: MissionSelectionCandidate[];
	preparation?: MissionPreparationStatus;
};

export type MissionData = MissionStatus;

export function isMissionTaskStatus(value: unknown): value is MissionTaskStatus {
	return value === 'todo' || value === 'active' || value === 'blocked' || value === 'done';
}

export function isMissionTaskAgent(value: unknown): value is MissionTaskAgent {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isGateIntent(value: unknown): value is GateIntent {
	return typeof value === 'string' && (MISSION_GATE_INTENTS as readonly string[]).includes(value);
}
