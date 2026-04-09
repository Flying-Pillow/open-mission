import type {
	MissionSystemSnapshot,
	GateIntent,
	OperatorActionExecutionStep,
	MissionBrief,
	MissionGateResult,
	MissionSelector,
	OperatorStatus,
	TrackedIssueSummary
} from '../types.js';
import type {
	AgentCommand,
	AgentCommandKind,
	AgentPrompt
} from '../runtime/AgentRuntimeTypes.js';
import type {
	WorkflowSettingsGetResult,
	WorkflowSettingsInitializeRequest,
	WorkflowSettingsInitializeResult,
	WorkflowSettingsUpdateRequest,
	WorkflowSettingsUpdateResult,
	WorkflowSettingsValidationError
} from '../settings/types.js';

export type MissionAgentPrimitiveValue = string | number | boolean | null;

export type MissionAgentConsoleState = {
	title?: string;
	lines: string[];
	promptOptions: string[] | null;
	awaitingInput: boolean;
	runtimeId?: string;
	runtimeLabel?: string;
	sessionId?: string;
};

export type MissionAgentConsoleEvent =
	| {
		type: 'reset';
		state: MissionAgentConsoleState;
	}
	| {
		type: 'lines';
		lines: string[];
		state: MissionAgentConsoleState;
	}
	| {
		type: 'prompt';
		state: MissionAgentConsoleState;
	};

export type MissionAgentLifecycleState =
	| 'idle'
	| 'starting'
	| 'running'
	| 'awaiting-input'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'terminated';

export type MissionAgentPermissionKind =
	| 'input'
	| 'tool'
	| 'filesystem'
	| 'command'
	| 'unknown';

export type MissionAgentPermissionRequest = {
	id: string;
	kind: MissionAgentPermissionKind;
	prompt: string;
	options: string[];
	providerDetails?: Record<string, MissionAgentPrimitiveValue>;
};

export type MissionAgentModelInfo = {
	id?: string;
	family?: string;
	provider?: string;
	displayName?: string;
};

export type MissionAgentTelemetrySnapshot = {
	model?: MissionAgentModelInfo;
	providerSessionId?: string;
	tokenUsage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
	contextWindow?: {
		usedTokens?: number;
		maxTokens?: number;
		utilization?: number;
	};
	estimatedCostUsd?: number;
	activeToolName?: string;
	updatedAt: string;
};

export type MissionAgentScope =
	| {
		kind: 'control';
		workspaceRoot?: string;
		repoName?: string;
		branch?: string;
	}
	| {
		kind: 'mission';
		missionId?: string;
		stage?: string;
		currentSlice?: string;
		readyTaskIds?: string[];
		readyTaskTitle?: string;
		readyTaskInstruction?: string;
	}
	| {
		kind: 'artifact';
		missionId?: string;
		stage?: string;
		artifactKey: string;
		artifactPath?: string;
		checkpoint?: string;
		validation?: string;
	}
	| {
		kind: 'slice';
		missionId?: string;
		missionDir?: string;
		stage?: string;
		sliceTitle: string;
		sliceId?: string;
		taskId?: string;
		taskTitle?: string;
		taskSummary?: string;
		taskInstruction?: string;
		doneWhen?: string[];
		stopCondition?: string;
		verificationTargets: string[];
		requiredSkills: string[];
		dependsOn: string[];
	}
	| {
		kind: 'gate';
		missionId?: string;
		stage?: string;
		intent: string;
	};

export type MissionAgentTurnRequest = {
	workingDirectory: string;
	prompt: string;
	scope?: MissionAgentScope;
	title?: string;
	operatorIntent?: string;
	startFreshSession?: boolean;
};

export type MissionAgentSessionState = {
	runtimeId: string;
	transportId?: string;
	runtimeLabel: string;
	sessionId: string;
	lifecycleState: MissionAgentLifecycleState;
	workingDirectory?: string;
	currentTurnTitle?: string;
	scope?: MissionAgentScope;
	awaitingPermission?: MissionAgentPermissionRequest;
	telemetry?: MissionAgentTelemetrySnapshot;
	failureMessage?: string;
	lastUpdatedAt: string;
};

export type MissionAgentSessionRecord = {
	sessionId: string;
	runtimeId: string;
	transportId?: string;
	runtimeLabel: string;
	lifecycleState: MissionAgentLifecycleState;
	taskId?: string;
	assignmentLabel?: string;
	workingDirectory?: string;
	currentTurnTitle?: string;
	scope?: MissionAgentScope;
	telemetry?: MissionAgentTelemetrySnapshot;
	failureMessage?: string;
	createdAt: string;
	lastUpdatedAt: string;
};

export type MissionAgentSessionLaunchRequest = MissionAgentTurnRequest & {
	runtimeId: string;
	transportId?: string;
	sessionId?: string;
	taskId?: string;
	assignmentLabel?: string;
};

export type MissionAgentEvent =
	| {
		type: 'session-state-changed';
		state: MissionAgentSessionState;
	}
	| {
		type: 'prompt-accepted';
		prompt: string;
		state: MissionAgentSessionState;
	}
	| {
		type: 'prompt-rejected';
		prompt: string;
		reason: string;
		state: MissionAgentSessionState;
	}
	| {
		type: 'session-started';
		state: MissionAgentSessionState;
	}
	| {
		type: 'session-resumed';
		state: MissionAgentSessionState;
	}
	| {
		type: 'agent-message';
		channel: 'stdout' | 'stderr' | 'system';
		text: string;
		state: MissionAgentSessionState;
	}
	| {
		type: 'permission-requested';
		request: MissionAgentPermissionRequest;
		state: MissionAgentSessionState;
	}
	| {
		type: 'tool-started';
		toolName: string;
		summary?: string;
		state: MissionAgentSessionState;
	}
	| {
		type: 'tool-finished';
		toolName: string;
		summary?: string;
		state: MissionAgentSessionState;
	}
	| {
		type: 'telemetry-updated';
		telemetry: MissionAgentTelemetrySnapshot;
		state: MissionAgentSessionState;
	}
	| {
		type: 'context-updated';
		telemetry: MissionAgentTelemetrySnapshot;
		state: MissionAgentSessionState;
	}
	| {
		type: 'cost-updated';
		telemetry: MissionAgentTelemetrySnapshot;
		state: MissionAgentSessionState;
	}
	| {
		type: 'session-completed';
		exitCode: number;
		state: MissionAgentSessionState;
	}
	| {
		type: 'session-failed';
		errorMessage: string;
		exitCode?: number;
		state: MissionAgentSessionState;
	}
	| {
		type: 'session-cancelled';
		reason?: string;
		state: MissionAgentSessionState;
	};

export const PROTOCOL_VERSION = 13;

export type Method =
	| 'ping'
	| 'airport.status'
	| 'airport.client.connect'
	| 'airport.client.observe'
	| 'airport.gate.bind'
	| 'control.status'
	| 'control.settings.update'
	| 'control.document.read'
	| 'control.document.write'
	| 'control.workflow.settings.get'
	| 'control.workflow.settings.initialize'
	| 'control.workflow.settings.update'
	| 'control.issues.list'
	| 'control.action.describe'
	| 'control.action.execute'
	| 'mission.from-brief'
	| 'mission.from-issue'
	| 'mission.status'
	| 'mission.action.execute'
	| 'mission.gate.evaluate'
	| 'task.launch'
	| 'session.list'
	| 'session.console.state'
	| 'session.prompt'
	| 'session.command'
	| 'session.cancel'
	| 'session.terminate';

export type Endpoint = {
	transport: 'ipc';
	path: string;
};

export type Manifest = {
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
	endpoint: Endpoint;
};

export type Ping = {
	ok: true;
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
};

export type MissionSelect = {
	selector?: MissionSelector;
};

export type MissionFromBriefRequest = {
	brief: MissionBrief;
	branchRef?: string;
};

export type MissionFromIssueRequest = {
	issueNumber: number;
};

export type ControlSettingsUpdate = {
	field: 'agentRuntime' | 'defaultAgentMode' | 'defaultModel' | 'towerTheme' | 'instructionsPath' | 'skillsPath';
	value: string;
};

export type ControlDocumentRead = {
	filePath: string;
};

export type ControlDocumentWrite = {
	filePath: string;
	content: string;
};

export type ControlDocumentResponse = {
	filePath: string;
	content: string;
	updatedAt?: string;
};

export type ControlWorkflowSettingsGet = Record<string, never>;

export type ControlWorkflowSettingsInitialize = WorkflowSettingsInitializeRequest;

export type ControlWorkflowSettingsInitializeResponse = WorkflowSettingsInitializeResult & {
	status: OperatorStatus;
};

export type ControlWorkflowSettingsUpdate = WorkflowSettingsUpdateRequest;

export type ControlWorkflowSettingsUpdateResponse = WorkflowSettingsUpdateResult & {
	status: OperatorStatus;
};

export type MissionGateEvaluate = MissionSelect & {
	intent: GateIntent;
};

export type ControlActionExecute = {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
};

export type ControlActionDescribe = {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
};

export type MissionActionExecute = MissionSelect & {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
};

export type TaskSelect = MissionSelect & {
	taskId: string;
};

export type TaskLaunch = TaskSelect & {
	request?: Partial<Omit<MissionAgentSessionLaunchRequest, 'runtimeId' | 'taskId'>> & {
		runtimeId?: string;
	};
};

export type SessionSelect = MissionSelect & {
	sessionId: string;
};

export type SessionConsoleState = SessionSelect;

export type SessionPrompt = SessionSelect & {
	prompt: AgentPrompt;
};

export type SessionCommand = SessionSelect & {
	command: AgentCommand;
};

export type SessionControl = SessionSelect & {
	reason?: string;
};

export type MissionAgentSessionCommandRequest = {
	kind: AgentCommandKind;
	metadata?: Record<string, MissionAgentPrimitiveValue>;
};

export type ControlIssuesList = {
	limit?: number;
};

export type AirportClientConnect = {
	gateId: 'dashboard' | 'editor' | 'pilot';
	label?: string;
	panelProcessId?: string;
	terminalSessionName?: string;
};

export type AirportClientObserve = {
	focusedGateId?: 'dashboard' | 'editor' | 'pilot';
	intentGateId?: 'dashboard' | 'editor' | 'pilot';
	repositoryId?: string;
	missionId?: string;
	stageId?: string;
	taskId?: string;
	artifactId?: string;
	agentSessionId?: string;
};

export type AirportGateBind = {
	gateId: 'dashboard' | 'editor' | 'pilot';
	binding: {
		targetKind: 'empty' | 'repository' | 'mission' | 'task' | 'artifact' | 'agentSession';
		targetId?: string;
		mode?: 'view' | 'control';
	};
};

export type Notification =
	| {
		type: 'airport.state';
		snapshot: MissionSystemSnapshot;
	}
	| {
		type: 'mission.status';
		missionId: string;
		status: OperatorStatus;
	}
	| {
		type: 'session.console';
		missionId: string;
		sessionId: string;
		event: MissionAgentConsoleEvent;
	}
	| {
		type: 'session.event';
		missionId: string;
		sessionId: string;
		event: MissionAgentEvent;
	}
	| {
		type: 'session.lifecycle';
		missionId: string;
		sessionId: string;
		phase: 'spawned' | 'active' | 'terminated';
		lifecycleState: MissionAgentLifecycleState;
	}
	| {
		type: 'control.workflow.settings.updated';
		revision: string;
		changedPaths: string[];
		context: ControlWorkflowSettingsUpdate['context'];
	};

export type Request = {
	type: 'request';
	id: string;
	method: Method;
	surfacePath?: string;
	clientId?: string;
	params?: unknown;
};

export type SuccessResponse = {
	type: 'response';
	id: string;
	ok: true;
	result:
	| Ping
	| MissionSystemSnapshot
	| OperatorStatus
	| ControlDocumentResponse
	| MissionGateResult
	| WorkflowSettingsGetResult
	| ControlWorkflowSettingsInitializeResponse
	| ControlWorkflowSettingsUpdateResponse
	| MissionAgentConsoleState
	| null
	| MissionAgentSessionRecord
	| MissionAgentSessionRecord[]
	| TrackedIssueSummary[];
};

export type ErrorResponse = {
	type: 'response';
	id: string;
	ok: false;
	error: {
		message: string;
		code?: string;
		validationErrors?: WorkflowSettingsValidationError[];
	};
};

export type EventMessage = {
	type: 'event';
	event: Notification;
};

export type Response = SuccessResponse | ErrorResponse;

export type Message = Request | Response | EventMessage;
