import type { AgentContext, AgentEnvironment, AgentMode } from './agents/agentContext.js';
import type { MissionAgentSessionRecord } from './daemon/MissionAgentRuntime.js';
import type { MissionDaemonSettings } from './lib/daemonConfig.js';
import {
	MISSION_ARTIFACT_KEYS,
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	evaluateMissionStageStatusIntent,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getPrimaryMissionStageStatusIntent,
	getMissionTaskPairingDefinition,
	isMissionArtifactKey,
	isMissionStageId,
	isMissionStageProgress,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionStageStatusIntent,
	type MissionTaskPairingDefinition,
	type MissionStageProgress,
	type MissionTaskStatusIntent,
	type MissionWorkflowTaskStatus
} from './workflow/manifest.js';

export type { AgentContext, AgentEnvironment, AgentMode };

export {
	MISSION_ARTIFACT_LABELS,
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	evaluateMissionStageStatusIntent,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getPrimaryMissionStageStatusIntent,
	getMissionTaskPairingDefinition,
	isMissionArtifactKey,
	isMissionStageId,
	isMissionStageProgress
};

export type {
	MissionArtifactKey,
	MissionStageId,
	MissionStageProgress,
	MissionStageStatusIntent,
	MissionTaskPairingDefinition,
	MissionTaskStatusIntent,
	MissionWorkflowTaskStatus
};

export type MissionProductKey = MissionArtifactKey;

export const MISSION_CONTROL_FILE_NAME = 'mission.json';
export const MISSION_CONTROL_SCHEMA_VERSION = 3;

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

export type MissionTaskControlState = {
	id: string;
	status: MissionTaskStatus;
	agent: MissionTaskAgent;
	retries: number;
	updatedAt: string;
};

export type MissionStageControlState = {
	id: MissionStageId;
	folder: string;
	status: MissionStageProgress;
	tasks: MissionTaskControlState[];
};

export type MissionControlState = {
	schemaVersion: typeof MISSION_CONTROL_SCHEMA_VERSION;
	updatedAt: string;
	stages: MissionStageControlState[];
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
	agentContext?: AgentContext;
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

export type MissionCommandScope = 'mission' | 'stage' | 'task' | 'session';

export type MissionCommandFlowSelectionMode = 'single' | 'multiple';
export type MissionCommandFlowTextMode = 'compact' | 'expanded';
export type MissionCommandFlowTextFormat = 'plain' | 'markdown';

export type MissionCommandFlowOption = {
	id: string;
	label: string;
	description: string;
};

export type MissionCommandFlowSelectionStep = {
	kind: 'selection';
	id: string;
	label: string;
	title: string;
	emptyLabel: string;
	helperText: string;
	selectionMode: MissionCommandFlowSelectionMode;
	options: MissionCommandFlowOption[];
};

export type MissionCommandFlowTextStep = {
	kind: 'text';
	id: string;
	label: string;
	title: string;
	helperText: string;
	placeholder: string;
	initialValue?: string;
	inputMode: MissionCommandFlowTextMode;
	format: MissionCommandFlowTextFormat;
};

export type MissionCommandFlowStep = MissionCommandFlowSelectionStep | MissionCommandFlowTextStep;

export type MissionCommandFlowDescriptor = {
	targetLabel: string;
	actionLabel: string;
	steps: MissionCommandFlowStep[];
};

export type MissionCommandUiMetadata = {
	toolbarLabel?: string;
	requiresConfirmation?: boolean;
	confirmationPrompt?: string;
};

export type MissionCommandDescriptor = {
	id: string;
	label: string;
	command: string;
	scope: MissionCommandScope;
	targetId?: string;
	enabled: boolean;
	reason?: string;
	flow?: MissionCommandFlowDescriptor;
	ui?: MissionCommandUiMetadata;
};

export type MissionSelectionCandidate = {
	missionId: string;
	title: string;
	branchRef: string;
	createdAt: string;
	issueId?: number;
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
	recommendedCommand?: string;
	availableCommands?: MissionCommandDescriptor[];
	availableMissions?: MissionSelectionCandidate[];
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
