import type {
	MissionAgentConsoleState,
	MissionAgentSessionRecord,
	MissionAgentSessionLaunchRequest,
	MissionAgentTurnRequest
} from '../daemon/MissionAgentRuntime.js';
import type {
	CommandExecute,
	CommandExecuteResult,
	ControlMissionBootstrap,
	ControlMissionStart,
	ControlSettingsUpdate
} from '../daemon/protocol.js';
import type {
	GateIntent,
	MissionGateResult,
	MissionSelector,
	MissionStageId,
	MissionStatus,
	TrackedIssueSummary
} from '../types.js';
import type { DaemonClient } from './DaemonClient.js';

export async function getControlStatus(client: DaemonClient): Promise<MissionStatus> {
	return client.request<MissionStatus>('control.status');
}

export async function updateControlSetting(
	client: DaemonClient,
	field: ControlSettingsUpdate['field'],
	value: string
): Promise<MissionStatus> {
	return client.request<MissionStatus>('control.settings.update', { field, value });
}

export async function startMission(
	client: DaemonClient,
	params: ControlMissionStart
): Promise<MissionStatus> {
	return client.request<MissionStatus>('control.mission.start', params);
}

export async function bootstrapMissionFromIssue(
	client: DaemonClient,
	issueNumber: number,
	agentContext?: ControlMissionBootstrap['agentContext']
): Promise<MissionStatus> {
	return client.request<MissionStatus>('control.mission.bootstrap', {
		issueNumber,
		...(agentContext ? { agentContext } : {})
	});
}

export async function listOpenGitHubIssues(
	client: DaemonClient,
	limit = 50
): Promise<TrackedIssueSummary[]> {
	return client.request<TrackedIssueSummary[]>('control.issues.list', { limit });
}

export async function executeCommand(
	client: DaemonClient,
	params: CommandExecute
): Promise<CommandExecuteResult> {
	return client.request<CommandExecuteResult>('command.execute', params);
}

export async function getMissionStatus(
	client: DaemonClient,
	selector: MissionSelector
): Promise<MissionStatus> {
	if (!selector.missionId) {
		throw new Error('Mission status requires an explicit missionId selector.');
	}
	return client.request<MissionStatus>('mission.status', { selector });
}

export async function evaluateMissionGate(
	client: DaemonClient,
	selector: MissionSelector,
	intent: GateIntent
): Promise<MissionGateResult> {
	if (!selector.missionId) {
		throw new Error('Mission gate evaluation requires an explicit missionId selector.');
	}
	return client.request<MissionGateResult>('mission.gate.evaluate', { selector, intent });
}

export async function deliverMission(
	client: DaemonClient,
	selector: MissionSelector
): Promise<MissionStatus> {
	if (!selector.missionId) {
		throw new Error('Mission delivery requires an explicit missionId selector.');
	}
	return client.request<MissionStatus>('mission.deliver', { selector });
}

export async function transitionMissionStage(
	client: DaemonClient,
	selector: MissionSelector,
	toStage: MissionStageId
): Promise<MissionStatus> {
	if (!selector.missionId) {
		throw new Error('Mission stage transition requires an explicit missionId selector.');
	}
	return client.request<MissionStatus>('stage.transition', { selector, toStage });
}

export async function activateTask(
	client: DaemonClient,
	selector: MissionSelector,
	taskId: string
): Promise<MissionStatus> {
	if (!selector.missionId) {
		throw new Error('Mission task activation requires an explicit missionId selector.');
	}
	return client.request<MissionStatus>('task.activate', { selector, taskId });
}

export async function completeTask(
	client: DaemonClient,
	selector: MissionSelector,
	taskId: string
): Promise<MissionStatus> {
	if (!selector.missionId) {
		throw new Error('Mission task completion requires an explicit missionId selector.');
	}
	return client.request<MissionStatus>('task.complete', { selector, taskId });
}

export async function launchTaskSession(
	client: DaemonClient,
	selector: MissionSelector,
	taskId: string,
	request?: Partial<Omit<MissionAgentSessionLaunchRequest, 'runtimeId' | 'taskId'>> & {
		runtimeId?: string;
	}
): Promise<MissionAgentSessionRecord> {
	if (!selector.missionId) {
		throw new Error('Mission task launch requires an explicit missionId selector.');
	}
	return client.request<MissionAgentSessionRecord>('task.launch', {
		selector,
		taskId,
		...(request ? { request } : {})
	});
}

export async function listMissionSessions(
	client: DaemonClient,
	selector: MissionSelector
): Promise<MissionAgentSessionRecord[]> {
	if (!selector.missionId) {
		throw new Error('Mission session listing requires an explicit missionId selector.');
	}
	return client.request<MissionAgentSessionRecord[]>('session.list', { selector });
}

export async function getSessionConsoleState(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string
): Promise<MissionAgentConsoleState | null> {
	return client.request<MissionAgentConsoleState | null>('session.console.state', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId
	});
}

export async function submitSessionTurn(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string,
	request: MissionAgentTurnRequest
): Promise<MissionAgentSessionRecord> {
	return client.request<MissionAgentSessionRecord>('session.turn.submit', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId,
		request
	});
}

export async function sendSessionInput(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string,
	text: string
): Promise<MissionAgentSessionRecord> {
	return client.request<MissionAgentSessionRecord>('session.send', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId,
		text
	});
}

export async function resizeSession(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string,
	cols: number,
	rows: number
): Promise<MissionAgentSessionRecord> {
	return client.request<MissionAgentSessionRecord>('session.resize', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId,
		cols,
		rows
	});
}

export async function cancelSession(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string,
	reason?: string
): Promise<MissionAgentSessionRecord> {
	return client.request<MissionAgentSessionRecord>('session.cancel', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId,
		...(reason ? { reason } : {})
	});
}

export async function terminateSession(
	client: DaemonClient,
	selector: MissionSelector | undefined,
	sessionId: string,
	reason?: string
): Promise<MissionAgentSessionRecord> {
	return client.request<MissionAgentSessionRecord>('session.terminate', {
		...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
		sessionId,
		...(reason ? { reason } : {})
	});
}

export function selectorFromStatus(
	status: MissionStatus,
	fallback: MissionSelector = {}
): MissionSelector {
	if (status.missionId) {
		return { missionId: status.missionId };
	}
	if (fallback.missionId) {
		return { missionId: fallback.missionId };
	}
	return {};
}
