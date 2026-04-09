import type {
	MissionActionList,
	MissionAgentConsoleState,
	MissionAgentSessionLaunchRequest,
	MissionAgentSessionRecord,
	MissionActionExecute,
	MissionFromBriefRequest,
	SessionCommand,
	SessionPrompt
} from '../daemon/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../runtime/AgentRuntimeTypes.js';
import type {
	GateIntent,
	OperatorActionDescriptor,
	OperatorActionExecutionStep,
	OperatorActionQueryContext,
	MissionGateResult,
	MissionSelector,
	OperatorStatus
} from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonMissionApi {
	public constructor(private readonly client: DaemonClient) { }

	public async fromBrief(
		params: MissionFromBriefRequest
	): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('mission.from-brief', params);
	}

	public async fromIssue(
		issueNumber: number
	): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('mission.from-issue', {
			issueNumber
		});
	}

	public async getStatus(selector: MissionSelector): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('mission.status', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission status')
		});
	}

	public async listAvailableActions(
		selector: MissionSelector,
		context?: OperatorActionQueryContext
	): Promise<OperatorActionDescriptor[]> {
		const resolvedSelector = DaemonMissionApi.requireSelector(selector, 'Mission action listing');
		const params: MissionActionList = {
			selector: resolvedSelector,
			...(context ? { context } : {})
		};
		return this.client.request<OperatorActionDescriptor[]>('mission.action.list', params);
	}

	public async executeAction(
		selector: MissionSelector,
		actionId: string,
		steps: OperatorActionExecutionStep[] = []
	): Promise<OperatorStatus> {
		const resolvedSelector = DaemonMissionApi.requireSelector(selector, `Mission action '${actionId}'`);
		const params: MissionActionExecute = {
			selector: resolvedSelector,
			actionId,
			...(steps.length > 0 ? { steps } : {})
		};
		return this.client.request<OperatorStatus>('mission.action.execute', params);
	}

	public async evaluateGate(
		selector: MissionSelector,
		intent: GateIntent
	): Promise<MissionGateResult> {
		return this.client.request<MissionGateResult>('mission.gate.evaluate', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission gate evaluation'),
			intent
		});
	}

	public async launchTaskSession(
		selector: MissionSelector,
		taskId: string,
		request?: Partial<Omit<MissionAgentSessionLaunchRequest, 'runtimeId' | 'taskId'>> & {
			runtimeId?: string;
		}
	): Promise<MissionAgentSessionRecord> {
		return this.client.request<MissionAgentSessionRecord>('task.launch', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission task launch'),
			taskId,
			...(request ? { request } : {})
		});
	}

	public async listSessions(
		selector: MissionSelector
	): Promise<MissionAgentSessionRecord[]> {
		return this.client.request<MissionAgentSessionRecord[]>('session.list', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission session listing')
		});
	}

	public async getSessionConsoleState(
		selector: MissionSelector | undefined,
		sessionId: string
	): Promise<MissionAgentConsoleState | null> {
		return this.client.request<MissionAgentConsoleState | null>('session.console.state', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId
		});
	}

	public async cancelSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		return this.client.request<MissionAgentSessionRecord>('session.cancel', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			...(reason ? { reason } : {})
		});
	}

	public async promptSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		prompt: AgentPrompt
	): Promise<MissionAgentSessionRecord> {
		const params: SessionPrompt = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			prompt
		};
		return this.client.request<MissionAgentSessionRecord>('session.prompt', params);
	}

	public async commandSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		command: AgentCommand
	): Promise<MissionAgentSessionRecord> {
		const params: SessionCommand = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			command
		};
		return this.client.request<MissionAgentSessionRecord>('session.command', params);
	}

	public async terminateSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		return this.client.request<MissionAgentSessionRecord>('session.terminate', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			...(reason ? { reason } : {})
		});
	}

	public static selectorFromStatus(
		status: OperatorStatus,
		fallback: MissionSelector = {}
	): MissionSelector {
		if (status.missionId) {
			return { missionId: status.missionId };
		}
		const projectedMissionId = status.system?.state.domain.selection.missionId
			?? status.system?.airportProjections.dashboard.missionId;
		if (projectedMissionId) {
			return { missionId: projectedMissionId };
		}
		if (fallback.missionId) {
			return { missionId: fallback.missionId };
		}
		return {};
	}

	private static requireSelector(
		selector: MissionSelector,
		operation: string
	): MissionSelector {
		if (!selector.missionId) {
			throw new Error(`${operation} requires an explicit missionId selector.`);
		}
		return selector;
	}
}