import type {
	GitHubIssueDetail,
	SystemSnapshot,
	GateIntent,
	GitHubVisibleRepository,
	OperatorActionListSnapshot,
	OperatorActionExecutionStep,
	OperatorActionQueryContext,
	MissionBrief,
	MissionGateResult,
	MissionSelector,
	OperatorStatus,
	TrackedIssueSummary
} from '../../types.js';
import type { SystemState } from '../../schemas/SystemState.js';
import type { Mission } from '../../entities/Mission/Mission.js';
import type { AgentSession } from '../../entities/AgentSession/AgentSession.js';
import type { Repository } from '../../entities/Repository/Repository.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../../agent/AgentRuntimeTypes.js';
import type {
	WorkflowSettingsGetResult,
	WorkflowSettingsInitializeRequest,
	WorkflowSettingsInitializeResult,
	WorkflowSettingsUpdateRequest,
	WorkflowSettingsUpdateResult,
	WorkflowSettingsValidationError
} from '../../settings/types.js';
import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from '../../schemas/EntityRemote.js';

export type MissionAgentPrimitiveValue = string | number | boolean | null;

export type MissionAgentConsoleState = {
	title?: string;
	lines: string[];
	promptOptions: string[] | null;
	awaitingInput: boolean;
	runnerId?: string;
	runnerLabel?: string;
	sessionId?: string;
};

export type MissionAgentTerminalState = {
	sessionId: string;
	connected: boolean;
	dead: boolean;
	exitCode: number | null;
	screen: string;
	truncated?: boolean;
	chunk?: string;
	terminalHandle?: {
		sessionName: string;
		paneId: string;
		sharedSessionName?: string;
	};
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
	runnerId: string;
	transportId?: string;
	runnerLabel: string;
	sessionId: string;
	sessionLogPath?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
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
	runnerId: string;
	transportId?: string;
	runnerLabel: string;
	sessionLogPath?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
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
	runnerId: string;
	terminalSessionName?: string;
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

export const PROTOCOL_VERSION = 26;

export type Method =
	| 'ping'
	| 'event.subscribe'
	| 'system.status'
	| 'airport.status'
	| 'airport.client.connect'
	| 'airport.client.observe'
	| 'airport.pane.bind'
	| 'entity.query'
	| 'entity.command'
	| 'control.status'
	| 'control.settings.update'
	| 'control.document.read'
	| 'control.document.write'
	| 'control.workflow.settings.get'
	| 'control.workflow.settings.initialize'
	| 'control.workflow.settings.update'
	| 'control.repositories.list'
	| 'control.repositories.add'
	| 'control.github.issue.detail'
	| 'control.issues.list'
	| 'control.action.list'
	| 'control.action.describe'
	| 'control.action.execute'
	| 'mission.from-brief'
	| 'mission.from-issue'
	| 'mission.operator-status'
	| 'mission.status'
	| 'mission.action.list'
	| 'mission.action.execute'
	| 'mission.gate.evaluate'
	| 'mission.terminal.state'
	| 'mission.terminal.input'
	| 'session.list'
	| 'session.console.state'
	| 'session.terminal.state'
	| 'session.terminal.input'
	| 'session.prompt'
	| 'session.command'
	| 'session.complete'
	| 'session.cancel'
	| 'session.terminate';

export type MethodWorkspaceRoute = 'none' | 'control' | 'mission';

export type MethodMetadata = {
	includeSurfacePath: boolean;
	workspaceRoute: MethodWorkspaceRoute;
};

export const METHOD_METADATA: Record<Method, MethodMetadata> = {
	'ping': { includeSurfacePath: false, workspaceRoute: 'none' },
	'event.subscribe': { includeSurfacePath: false, workspaceRoute: 'none' },
	'system.status': { includeSurfacePath: true, workspaceRoute: 'none' },
	'airport.status': { includeSurfacePath: true, workspaceRoute: 'none' },
	'airport.client.connect': { includeSurfacePath: true, workspaceRoute: 'none' },
	'airport.client.observe': { includeSurfacePath: true, workspaceRoute: 'none' },
	'airport.pane.bind': { includeSurfacePath: true, workspaceRoute: 'none' },
	'entity.query': { includeSurfacePath: true, workspaceRoute: 'control' },
	'entity.command': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.status': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.settings.update': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.document.read': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.document.write': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.workflow.settings.get': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.workflow.settings.initialize': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.workflow.settings.update': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.repositories.list': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.repositories.add': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.github.issue.detail': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.issues.list': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.action.list': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.action.describe': { includeSurfacePath: true, workspaceRoute: 'control' },
	'control.action.execute': { includeSurfacePath: true, workspaceRoute: 'control' },
	'mission.from-brief': { includeSurfacePath: true, workspaceRoute: 'control' },
	'mission.from-issue': { includeSurfacePath: true, workspaceRoute: 'control' },
	'mission.operator-status': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.status': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.action.list': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.action.execute': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.gate.evaluate': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.terminal.state': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'mission.terminal.input': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.list': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.console.state': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.terminal.state': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.terminal.input': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.prompt': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.command': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.complete': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.cancel': { includeSurfacePath: true, workspaceRoute: 'mission' },
	'session.terminate': { includeSurfacePath: true, workspaceRoute: 'mission' }
};

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
	field: 'agentRunner' | 'defaultAgentMode' | 'defaultModel' | 'towerTheme' | 'missionWorkspaceRoot' | 'instructionsPath' | 'skillsPath';
	value: string;
};

export type ControlDocumentRead = {
	filePath: string;
};

export type ControlDocumentWrite = {
	filePath: string;
	content: string;
};

export type SessionComplete = SessionSelect;

export type ControlDocumentResponse = {
	filePath: string;
	content: string;
	updatedAt?: string;
};

export type ControlWorkflowSettingsGet = Record<string, never>;

export type ControlStatus = {
	includeMissions?: boolean;
};

export type EntityQueryRequest = EntityQueryInvocation;
export type EntityCommandRequest = EntityCommandInvocation | EntityFormInvocation;
export type EntityQueryResponse = EntityRemoteResult;
export type EntityCommandResponse = EntityRemoteResult;

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

export type ControlActionList = {
	context?: OperatorActionQueryContext;
};

export type ControlActionExecute = {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
};

export type ControlActionDescribe = {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
};

export type MissionActionList = MissionSelect & {
	context?: OperatorActionQueryContext;
};

export type MissionActionExecute = MissionSelect & {
	actionId: string;
	steps?: OperatorActionExecutionStep[];
	terminalSessionName?: string;
};

export type TaskSelect = MissionSelect & {
	taskId: string;
};

export type SessionSelect = MissionSelect & {
	sessionId: string;
};

export type SessionConsoleState = SessionSelect;

export type SessionTerminalState = SessionSelect;

export type MissionTerminalStateRequest = MissionSelect;

export type SessionTerminalInput = SessionSelect & {
	data?: string;
	literal?: boolean;
	cols?: number;
	rows?: number;
	respondWithState?: boolean;
};

export type MissionTerminalInput = MissionSelect & {
	data?: string;
	literal?: boolean;
	cols?: number;
	rows?: number;
	respondWithState?: boolean;
};

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
	kind: AgentCommand['type'];
	metadata?: Record<string, MissionAgentPrimitiveValue>;
};

export type ControlRepositoriesList = Record<string, never>;

export type ControlGitHubIssueDetail = {
	issueNumber: number;
};

export type ControlRepositoriesAdd = {
	repositoryPath: string;
};

export type ControlIssuesList = {
	limit?: number;
};

export type AirportClientConnect = {
	paneId: 'tower' | 'briefingRoom' | 'runway';
	label?: string;
	panelProcessId?: string;
	terminalPaneId?: number;
	terminalSessionName?: string;
};

export type AirportClientObserve = {
	focusedPaneId?: 'tower' | 'briefingRoom' | 'runway';
	intentPaneId?: 'tower' | 'briefingRoom' | 'runway';
	repositoryId?: string;
	terminalPaneId?: number;
	terminalSessionName?: string;
};

export type AirportPaneBind = {
	paneId: 'briefingRoom' | 'runway';
	binding: {
		targetKind: 'empty' | 'repository' | 'mission' | 'task' | 'artifact' | 'agentSession';
		targetId?: string;
		mode?: 'view' | 'control';
	};
};

export type Notification =
	| {
		type: 'airport.state';
		snapshot: SystemSnapshot;
	}
	| {
		type: 'mission.actions.changed';
		workspaceRoot: string;
		missionId: string;
		revision: string;
	}
	| {
		type: 'mission.status';
		workspaceRoot: string;
		missionId: string;
		status: Mission;
	}
	| {
		type: 'session.console';
		missionId: string;
		sessionId: string;
		event: MissionAgentConsoleEvent;
	}
	| {
		type: 'session.terminal';
		missionId: string;
		sessionId: string;
		state: MissionAgentTerminalState;
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

export type EventSubscription = {
	eventTypes?: Notification['type'][];
	missionId?: string;
	sessionId?: string;
};

export type Request = {
	type: 'request';
	id: string;
	method: Method;
	surfacePath?: string;
	authToken?: string;
	clientId?: string;
	params?: unknown;
};

export type SuccessResponse = {
	type: 'response';
	id: string;
	ok: true;
	result:
	| Ping
	| SystemState
	| SystemSnapshot
	| OperatorStatus
	| ControlDocumentResponse
	| Mission
	| Repository
	| Repository[]
	| GitHubVisibleRepository[]
	| GitHubIssueDetail
	| EntityQueryResponse
	| EntityCommandResponse
	| MissionGateResult
	| WorkflowSettingsGetResult
	| ControlWorkflowSettingsInitializeResponse
	| ControlWorkflowSettingsUpdateResponse
	| MissionAgentConsoleState
	| MissionAgentTerminalState
	| null
	| AgentSession
	| AgentSession[]
	| OperatorActionListSnapshot
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
