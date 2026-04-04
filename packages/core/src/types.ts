import type { AgentContext, AgentEnvironment, AgentMode } from './agents/agentContext.js';
import type { MissionAgentSessionRecord } from './daemon/MissionAgentRuntime.js';
import type { MissionRepoSettings } from './lib/repoConfig.js';

export type { AgentContext, AgentEnvironment, AgentMode };

export type MissionStageId = 'prd' | 'spec' | 'plan' | 'implementation' | 'verification' | 'audit';

export const MISSION_STAGES: MissionStageId[] = [
	'prd',
	'spec',
	'plan',
	'implementation',
	'verification',
	'audit'
];

export type MissionProductKey = 'brief' | 'prd' | 'spec' | 'plan' | 'verification' | 'audit';

export const MISSION_ARTIFACTS = {
	brief: 'BRIEF.md',
	prd: 'PRD.md',
	spec: 'SPEC.md',
	plan: 'PLAN.md',
	verification: 'VERIFICATION.md',
	audit: 'AUDIT.md'
} as const satisfies Record<MissionProductKey, string>;

export const MISSION_ARTIFACT_LABELS = {
	brief: 'Brief',
	prd: 'Requirements',
	spec: 'Specification',
	plan: 'Plan',
	verification: 'Verification',
	audit: 'Audit'
} as const satisfies Record<MissionProductKey, string>;

export const MISSION_TASK_STAGE_DIRECTORIES = {
	prd: 'PRD',
	spec: 'SPEC',
	plan: 'PLAN',
	implementation: 'IMPLEMENTATION',
	verification: 'VERIFICATION',
	audit: 'AUDIT'
} as const satisfies Record<MissionStageId, string>;

export const MISSION_CONTROL_FILE_NAME = 'mission.json';
export const MISSION_CONTROL_SCHEMA_VERSION = 1;

export const MISSION_ARTIFACT_FILE_NAMES: string[] = Object.values(MISSION_ARTIFACTS);
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
export type MissionTaskStatus = 'todo' | 'active' | 'blocked' | 'done';
export type MissionTaskAgent = string;
export type MissionStageProgress = 'pending' | 'active' | 'blocked' | 'done';

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
	status: MissionTaskStatus;
	agent: MissionTaskAgent;
	retries: number;
	updatedAt: string;
};

export type MissionControlState = {
	schemaVersion: typeof MISSION_CONTROL_SCHEMA_VERSION;
	updatedAt: string;
	deliveredAt?: string;
	tasks: Record<string, MissionTaskControlState>;
};

export type MissionRecord = {
	id: string;
	brief: MissionBrief;
	missionDir: string;
	branchRef: string;
	createdAt: string;
	stage: MissionStageId;
	deliveredAt?: string;
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

export type MissionCommandDescriptor = {
	id: string;
	label: string;
	command: string;
	scope: MissionCommandScope;
	targetId?: string;
	enabled: boolean;
	reason?: string;
	flow?: MissionCommandFlowDescriptor;
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
	controlRepoRoot: string;
	missionDirectory: string;
	settingsPath: string;
	worktreesPath: string;
	currentBranch?: string;
	settings: MissionRepoSettings;
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
	deliveredAt?: string;
	branchRef?: string;
	missionDir?: string;
	productFiles?: Partial<Record<MissionProductKey, string>>;
	activeTasks?: MissionTaskState[];
	readyTasks?: MissionTaskState[];
	stages?: MissionStageStatus[];
	agentSessions?: MissionAgentSessionRecord[];
	recommendedCommand?: string;
	availableCommands?: MissionCommandDescriptor[];
	availableMissions?: MissionSelectionCandidate[];
};

export type MissionData = MissionStatus;

export function isMissionStageId(value: unknown): value is MissionStageId {
	return typeof value === 'string' && (MISSION_STAGES as readonly string[]).includes(value);
}

export function isMissionProductKey(value: unknown): value is MissionProductKey {
	return typeof value === 'string' && value in MISSION_ARTIFACTS;
}

export function isMissionTaskStatus(value: unknown): value is MissionTaskStatus {
	return value === 'todo' || value === 'active' || value === 'blocked' || value === 'done';
}

export function isMissionTaskAgent(value: unknown): value is MissionTaskAgent {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isGateIntent(value: unknown): value is GateIntent {
	return typeof value === 'string' && (MISSION_GATE_INTENTS as readonly string[]).includes(value);
}
