import type {
	AgentContext,
	GateIntent,
	MissionBrief,
	MissionGateResult,
	MissionSelector,
	MissionStatus,
	MissionStageId,
	TrackedIssueSummary
	} from '../types.js';
import type {
	MissionAgentConsoleEvent,
	MissionAgentConsoleState,
	MissionAgentEvent,
	MissionAgentLifecycleState,
	MissionAgentSessionLaunchRequest,
	MissionAgentSessionRecord,
	MissionAgentTurnRequest
} from './MissionAgentRuntime.js';

export const PROTOCOL_VERSION = 7;

export type Method =
	| 'ping'
	| 'command.execute'
	| 'control.session.launch'
	| 'control.status'
	| 'control.settings.update'
	| 'control.mission.bootstrap'
	| 'control.mission.start'
	| 'control.issues.list'
	| 'mission.status'
	| 'mission.gate.evaluate'
	| 'mission.deliver'
	| 'stage.transition'
	| 'task.activate'
	| 'task.block'
	| 'task.complete'
	| 'task.launch'
	| 'session.list'
	| 'session.console.state'
	| 'session.turn.submit'
	| 'session.send'
	| 'session.resize'
	| 'session.cancel'
	| 'session.terminate';

export type Endpoint = {
	transport: 'ipc';
	path: string;
};

export type Manifest = {
	repoRoot: string;
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
	endpoint: Endpoint;
};

export type Ping = {
	ok: true;
	repoRoot: string;
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
};

export type MissionSelect = {
	selector?: MissionSelector;
};

export type CommandExecuteSelectionStep = {
	kind: 'selection';
	stepId: string;
	optionIds: string[];
};

export type CommandExecuteTextStep = {
	kind: 'text';
	stepId: string;
	value: string;
};

export type CommandExecuteStep = CommandExecuteSelectionStep | CommandExecuteTextStep;

export type CommandExecute = MissionSelect & {
	commandId: string;
	steps: CommandExecuteStep[];
};

export type CommandExecuteResult = {
	status?: MissionStatus;
	session?: MissionAgentSessionRecord;
	issues?: TrackedIssueSummary[];
};

export type ControlMissionStart = {
	brief: MissionBrief;
	branchRef?: string;
	agentContext?: AgentContext;
};

export type ControlMissionBootstrap = {
	issueNumber: number;
	agentContext?: AgentContext;
};

export type ControlSettingsUpdate = {
	field: 'agentRunner' | 'defaultAgentMode' | 'defaultModel' | 'instructionsPath' | 'skillsPath';
	value: string;
};

export type ControlSessionLaunch = {
	request?: Partial<Omit<MissionAgentSessionLaunchRequest, 'taskId'>> & {
		runtimeId?: string;
	};
};

export type MissionGateEvaluate = MissionSelect & {
	intent: GateIntent;
};

export type StageTransition = MissionSelect & {
	toStage: MissionStageId;
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

export type SessionTurnSubmit = SessionSelect & {
	request: MissionAgentTurnRequest;
};

export type SessionConsoleState = SessionSelect;

export type SessionInput = SessionSelect & {
	text: string;
};

export type SessionResize = SessionSelect & {
	cols: number;
	rows: number;
};

export type SessionControl = SessionSelect & {
	reason?: string;
};

export type ControlIssuesList = {
	limit?: number;
};

export type Notification =
	| {
			type: 'mission.status';
			missionId: string;
			status: MissionStatus;
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
	  };

export type Request = {
	type: 'request';
	id: string;
	method: Method;
	params?: unknown;
};

export type SuccessResponse = {
	type: 'response';
	id: string;
	ok: true;
	result:
		| Ping
		| CommandExecuteResult
		| MissionStatus
		| MissionGateResult
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
	};
};

export type EventMessage = {
	type: 'event';
	event: Notification;
};

export type Response = SuccessResponse | ErrorResponse;

export type Message = Request | Response | EventMessage;