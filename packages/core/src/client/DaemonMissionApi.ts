import type {
	MissionActionList,
	MissionAgentConsoleState,
	MissionAgentTerminalState,
	MissionActionExecute,
	MissionFromBriefRequest,
	SessionComplete,
	SessionCommand,
	SessionTerminalInput,
	SessionPrompt
} from '../daemon/protocol/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../agent/AgentRuntimeTypes.js';
import type {
	GateIntent,
	OperatorActionDescriptor,
	OperatorActionListSnapshot,
	OperatorActionExecutionStep,
	OperatorActionQueryContext,
	MissionGateResult,
	MissionSelector,
	OperatorStatus
} from '../types.js';
import type { Mission } from '../entities/Mission/Mission.js';
import type { AgentSession } from '../entities/AgentSession/AgentSession.js';
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

	public async getStatus(selector: MissionSelector): Promise<Mission> {
		return this.client.request<Mission>('mission.status', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission status')
		});
	}

	public async getMission(selector: MissionSelector): Promise<Mission> {
		return this.getStatus(selector);
	}

	public async getOperatorStatus(selector: MissionSelector): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('mission.operator-status', {
			selector: DaemonMissionApi.requireSelector(selector, 'Mission operator status')
		});
	}

	public async listAvailableActions(
		selector: MissionSelector,
		context?: OperatorActionQueryContext
	): Promise<OperatorActionDescriptor[]> {
		const snapshot = await this.listAvailableActionsSnapshot(selector, context);
		return snapshot.actions;
	}

	public async listAvailableActionsSnapshot(
		selector: MissionSelector,
		context?: OperatorActionQueryContext
	): Promise<OperatorActionListSnapshot> {
		const resolvedSelector = DaemonMissionApi.requireSelector(selector, 'Mission action listing');
		const params: MissionActionList = {
			selector: resolvedSelector,
			...(context ? { context } : {})
		};
		return this.client.request<OperatorActionListSnapshot>('mission.action.list', params);
	}

	public async executeAction(
		selector: MissionSelector,
		actionId: string,
		steps: OperatorActionExecutionStep[] = [],
		options: { terminalSessionName?: string } = {}
	): Promise<Mission> {
		const resolvedSelector = DaemonMissionApi.requireSelector(selector, `Mission action '${actionId}'`);
		const params: MissionActionExecute = {
			selector: resolvedSelector,
			actionId,
			...(steps.length > 0 ? { steps } : {}),
			...(options.terminalSessionName?.trim() ? { terminalSessionName: options.terminalSessionName.trim() } : {})
		};
		return this.client.request<Mission>('mission.action.execute', params);
	}

	public async executeMissionAction(
		selector: MissionSelector,
		actionId: string,
		steps: OperatorActionExecutionStep[] = [],
		options: { terminalSessionName?: string } = {}
	): Promise<Mission> {
		return this.executeAction(selector, actionId, steps, options);
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

	public async getMissionTerminalState(
		selector: MissionSelector | undefined
	): Promise<MissionAgentTerminalState | null> {
		return this.client.request<MissionAgentTerminalState | null>('mission.terminal.state', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {})
		});
	}

	public async sendMissionTerminalInput(
		selector: MissionSelector | undefined,
		input: { data?: string; literal?: boolean; cols?: number; rows?: number; respondWithState?: boolean }
	): Promise<MissionAgentTerminalState | null> {
		return this.client.request<MissionAgentTerminalState | null>('mission.terminal.input', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			...(input.data !== undefined ? { data: input.data } : {}),
			...(input.literal !== undefined ? { literal: input.literal } : {}),
			...(input.cols !== undefined ? { cols: input.cols } : {}),
			...(input.rows !== undefined ? { rows: input.rows } : {}),
			...(input.respondWithState !== undefined ? { respondWithState: input.respondWithState } : {})
		});
	}

	public async listSessions(
		selector: MissionSelector
	): Promise<AgentSession[]> {
		return this.client.request<AgentSession[]>('session.list', {
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

	public async getSessionTerminalState(
		selector: MissionSelector | undefined,
		sessionId: string
	): Promise<MissionAgentTerminalState | null> {
		return this.client.request<MissionAgentTerminalState | null>('session.terminal.state', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId
		});
	}

	public async sendSessionTerminalInput(
		selector: MissionSelector | undefined,
		sessionId: string,
		input: { data?: string; literal?: boolean; cols?: number; rows?: number; respondWithState?: boolean }
	): Promise<MissionAgentTerminalState | null> {
		const params: SessionTerminalInput = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			...(input.data !== undefined ? { data: input.data } : {}),
			...(input.literal !== undefined ? { literal: input.literal } : {}),
			...(input.cols !== undefined ? { cols: input.cols } : {}),
			...(input.rows !== undefined ? { rows: input.rows } : {}),
			...(input.respondWithState !== undefined ? { respondWithState: input.respondWithState } : {})
		};
		return this.client.request<MissionAgentTerminalState | null>('session.terminal.input', params);
	}

	public async cancelSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		reason?: string
	): Promise<AgentSession> {
		return this.client.request<AgentSession>('session.cancel', {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			...(reason ? { reason } : {})
		});
	}

	public async promptSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		prompt: AgentPrompt
	): Promise<AgentSession> {
		const params: SessionPrompt = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			prompt
		};
		return this.client.request<AgentSession>('session.prompt', params);
	}

	public async commandSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		command: AgentCommand
	): Promise<AgentSession> {
		const params: SessionCommand = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId,
			command
		};
		return this.client.request<AgentSession>('session.command', params);
	}

	public async completeSession(
		selector: MissionSelector | undefined,
		sessionId: string
	): Promise<AgentSession> {
		const params: SessionComplete = {
			...(selector && Object.keys(selector).length > 0 ? { selector } : {}),
			sessionId
		};
		return this.client.request<AgentSession>('session.complete', params);
	}

	public async terminateSession(
		selector: MissionSelector | undefined,
		sessionId: string,
		reason?: string
	): Promise<AgentSession> {
		return this.client.request<AgentSession>('session.terminate', {
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
		if (fallback.missionId) {
			return { missionId: fallback.missionId };
		}
		const selectedMissionId = status.system?.state.domain.selection.missionId;
		if (selectedMissionId) {
			return { missionId: selectedMissionId };
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
