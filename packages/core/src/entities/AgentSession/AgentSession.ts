import type {
	AgentCommand,
	AgentPrompt,
	AgentSessionSnapshot
} from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import type { EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionTaskState } from '../../types.js';
import { toAgentSession, type AgentSessionData } from './AgentSessionData.js';
import type {
	MissionAgentModelInfo,
	MissionAgentScope,
	AgentSessionLaunchRequest,
	AgentSessionRecord,
	AgentSessionState,
	MissionAgentTelemetrySnapshot
} from '../../daemon/protocol/contracts.js';
import {
	agentSessionCommandAcknowledgementSchema,
	agentSessionExecuteCommandPayloadSchema,
	agentSessionIdentityPayloadSchema,
	agentSessionReadTerminalPayloadSchema,
	agentSessionSendCommandPayloadSchema,
	agentSessionSendPromptPayloadSchema,
	agentSessionSendTerminalInputPayloadSchema,
	agentSessionTerminalSnapshotSchema,
	agentSessionSnapshotSchema
} from './AgentSessionSchema.js';

export type AgentSessionOwner = {
	completeSessionRecord(sessionId: string): Promise<AgentSessionRecord>;
	cancelSessionRecord(sessionId: string, reason?: string): Promise<AgentSessionRecord>;
	terminateSessionRecord(sessionId: string, reason?: string): Promise<AgentSessionRecord>;
	sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<AgentSessionRecord>;
	sendSessionCommand(sessionId: string, command: AgentCommand): Promise<AgentSessionRecord>;
};

type AgentSessionLaunchRecord = {
	sessionId: string;
	runnerId: string;
	transportId?: string | undefined;
	sessionLogPath?: string | undefined;
	terminalSessionName?: string | undefined;
	terminalPaneId?: string | undefined;
	taskId: string;
	lifecycle: AgentSessionRecord['lifecycleState'] | AgentSessionSnapshot['status'];
	launchedAt: string;
	updatedAt: string;
};

export class AgentSession {
	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionIdentityPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return agentSessionSnapshotSchema.parse(service.requireAgentSession(await service.buildMissionSnapshot(mission, input.missionId), input.sessionId));
		} finally {
			mission.dispose();
		}
	}

	public static async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionReadTerminalPayloadSchema.parse(payload);
		const { readAgentSessionTerminalState } = await import('../../daemon/AgentSessionTerminal.js');
		const state = await readAgentSessionTerminalState({
			surfacePath: context.surfacePath,
			selector: { missionId: input.missionId },
			sessionId: input.sessionId
		});
		if (!state) {
			throw new Error(`AgentSession terminal for '${input.sessionId}' is not available.`);
		}
		return agentSessionTerminalSnapshotSchema.parse({
			missionId: input.missionId,
			sessionId: input.sessionId,
			connected: state.connected,
			dead: state.dead,
			exitCode: state.dead ? state.exitCode : null,
			screen: state.screen,
			...(state.chunk ? { chunk: state.chunk } : {}),
			...(state.truncated ? { truncated: true } : {}),
			...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
		});
	}

	public static async executeCommand(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionExecuteCommandPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			service.requireAgentSession(await service.buildMissionSnapshot(mission, input.missionId), input.sessionId);
			switch (input.commandId) {
				case 'agentSession.complete':
					await mission.completeAgentSession(input.sessionId);
					break;
				case 'agentSession.cancel':
					await mission.cancelAgentSession(input.sessionId, service.getReason(input.input));
					break;
				case 'agentSession.terminate':
					await mission.terminateAgentSession(input.sessionId, service.getReason(input.input));
					break;
				default:
					throw new Error(`AgentSession command '${input.commandId}' is not implemented in the daemon.`);
			}
			return agentSessionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'AgentSession',
				method: 'executeCommand',
				id: input.sessionId,
				missionId: input.missionId,
				sessionId: input.sessionId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	public static async sendPrompt(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionSendPromptPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			service.requireAgentSession(await service.buildMissionSnapshot(mission, input.missionId), input.sessionId);
			await mission.sendAgentSessionPrompt(input.sessionId, service.normalizeAgentPrompt(input.prompt));
			return agentSessionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'AgentSession',
				method: 'sendPrompt',
				id: input.sessionId,
				missionId: input.missionId,
				sessionId: input.sessionId
			});
		} finally {
			mission.dispose();
		}
	}

	public static async sendCommand(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionSendCommandPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			service.requireAgentSession(await service.buildMissionSnapshot(mission, input.missionId), input.sessionId);
			await mission.sendAgentSessionCommand(input.sessionId, service.normalizeAgentCommand(input.command));
			return agentSessionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'AgentSession',
				method: 'sendCommand',
				id: input.sessionId,
				missionId: input.missionId,
				sessionId: input.sessionId
			});
		} finally {
			mission.dispose();
		}
	}

	public static async sendTerminalInput(payload: unknown, context: EntityExecutionContext) {
		const input = agentSessionSendTerminalInputPayloadSchema.parse(payload);
		const { sendAgentSessionTerminalInput } = await import('../../daemon/AgentSessionTerminal.js');
		const state = await sendAgentSessionTerminalInput({
			surfacePath: context.surfacePath,
			selector: { missionId: input.missionId },
			terminalInput: {
				sessionId: input.sessionId,
				...(input.data !== undefined ? { data: input.data } : {}),
				...(input.literal !== undefined ? { literal: input.literal } : {}),
				...(input.cols !== undefined ? { cols: input.cols } : {}),
				...(input.rows !== undefined ? { rows: input.rows } : {})
			}
		});
		if (!state) {
			throw new Error(`AgentSession terminal for '${input.sessionId}' is not available.`);
		}
		return agentSessionTerminalSnapshotSchema.parse({
			missionId: input.missionId,
			sessionId: input.sessionId,
			connected: state.connected,
			dead: state.dead,
			exitCode: state.dead ? state.exitCode : null,
			screen: state.screen,
			...(state.chunk ? { chunk: state.chunk } : {}),
			...(state.truncated ? { truncated: true } : {}),
			...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
		});
	}

	public static async isCompatibleForLaunch(input: {
		session: AgentSessionRecord;
		request: AgentSessionLaunchRequest;
		resolveLiveSession(): Promise<AgentSessionSnapshot | undefined>;
	}): Promise<boolean> {
		try {
			const liveSession = await input.resolveLiveSession();
			if (!liveSession || AgentSession.isTerminalRuntimeStatus(liveSession.status)) {
				return false;
			}
			if (liveSession.taskId !== input.request.taskId) {
				return false;
			}
			if (liveSession.workingDirectory && liveSession.workingDirectory !== input.request.workingDirectory) {
				return false;
			}
			return true;
		} catch {
			return true;
		}
	}

	public static isTerminalRuntimeStatus(status: AgentSessionSnapshot['status']): boolean {
		return status === 'completed'
			|| status === 'failed'
			|| status === 'cancelled'
			|| status === 'terminated';
	}

	public static lifecycleEventType(lifecycle: 'cancelled' | 'terminated'): 'session.cancelled' | 'session.terminated' {
		return lifecycle === 'cancelled' ? 'session.cancelled' : 'session.terminated';
	}

	public static buildTaskScope(
		task: MissionTaskState,
		missionId?: string,
		missionDir?: string
	): MissionAgentScope {
		return {
			kind: 'slice',
			sliceTitle: task.subject,
			verificationTargets: [],
			requiredSkills: [],
			dependsOn: [...task.dependsOn],
			...(missionId ? { missionId } : {}),
			...(missionDir ? { missionDir } : {}),
			...(task.stage ? { stage: task.stage } : {}),
			...(task.taskId ? { taskId: task.taskId } : {}),
			...(task.subject ? { taskTitle: task.subject } : {}),
			...(task.subject ? { taskSummary: task.subject } : {}),
			...(task.instruction ? { taskInstruction: task.instruction } : {})
		};
	}

	public static createRecordFromLaunch(input: {
		launch: AgentSessionLaunchRecord;
		runnerLabel: string;
		snapshot?: AgentSessionSnapshot;
		task?: MissionTaskState;
		missionId?: string;
		missionDir?: string;
	}): AgentSessionRecord {
		const scope = input.task
			? AgentSession.buildTaskScope(input.task, input.missionId, input.missionDir)
			: undefined;
		const transport = getTransportFields(input.snapshot);

		return AgentSession.cloneRecord({
			sessionId: input.launch.sessionId,
			runnerId: input.launch.runnerId,
			...(transport.transportId ? { transportId: transport.transportId } : input.launch.transportId ? { transportId: input.launch.transportId } : {}),
			...(input.launch.sessionLogPath ? { sessionLogPath: input.launch.sessionLogPath } : {}),
			...(transport.terminalSessionName
				? { terminalSessionName: transport.terminalSessionName }
				: input.launch.terminalSessionName
					? { terminalSessionName: input.launch.terminalSessionName }
					: {}),
			...(transport.terminalPaneId
				? { terminalPaneId: transport.terminalPaneId }
				: input.launch.terminalPaneId
					? { terminalPaneId: input.launch.terminalPaneId }
					: {}),
			runnerLabel: input.runnerLabel,
			lifecycleState: AgentSession.toLifecycleState(input.snapshot?.status ?? input.launch.lifecycle),
			createdAt: input.launch.launchedAt,
			lastUpdatedAt: input.snapshot?.updatedAt ?? input.launch.updatedAt,
			...(input.launch.taskId ? { taskId: input.launch.taskId } : {}),
			...(input.task?.relativePath ? { assignmentLabel: input.task.relativePath } : {}),
			...(input.snapshot?.workingDirectory ? { workingDirectory: input.snapshot.workingDirectory } : {}),
			...(input.task?.subject ? { currentTurnTitle: input.task.subject } : {}),
			...(scope ? { scope } : {}),
			...(input.snapshot?.failureMessage ? { failureMessage: input.snapshot.failureMessage } : {})
		});
	}

	public static createStateFromSnapshot(input: {
		snapshot: AgentSessionSnapshot;
		runnerLabel: string;
		record?: AgentSessionRecord;
	}): AgentSessionState {
		const { snapshot, runnerLabel, record } = input;
		const transport = getTransportFields(snapshot);
		return AgentSession.cloneState({
			runnerId: snapshot.runnerId,
			...(transport.transportId ? { transportId: transport.transportId } : {}),
			runnerLabel,
			sessionId: snapshot.sessionId,
			...(record?.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
			...(transport.terminalSessionName
				? { terminalSessionName: transport.terminalSessionName }
				: record?.terminalSessionName
					? { terminalSessionName: record.terminalSessionName }
					: {}),
			...(transport.terminalPaneId
				? { terminalPaneId: transport.terminalPaneId }
				: record?.terminalPaneId
					? { terminalPaneId: record.terminalPaneId }
					: {}),
			lifecycleState: AgentSession.toLifecycleState(snapshot.status),
			lastUpdatedAt: snapshot.updatedAt,
			...(snapshot.workingDirectory
				? { workingDirectory: snapshot.workingDirectory }
				: record?.workingDirectory
					? { workingDirectory: record.workingDirectory }
					: {}),
			...(record?.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			...(record?.scope ? { scope: record.scope } : {}),
			...(snapshot.failureMessage
				? { failureMessage: snapshot.failureMessage }
				: record?.failureMessage
					? { failureMessage: record.failureMessage }
					: {})
		});
	}

	public static cloneRecord(record: AgentSessionRecord): AgentSessionRecord {
		const telemetry = AgentSession.cloneTelemetry(record.telemetry);
		return {
			sessionId: record.sessionId,
			runnerId: record.runnerId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			...(record.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
			...(record.terminalSessionName ? { terminalSessionName: record.terminalSessionName } : {}),
			...(record.terminalPaneId ? { terminalPaneId: record.terminalPaneId } : {}),
			runnerLabel: record.runnerLabel,
			lifecycleState: record.lifecycleState,
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			...(record.scope ? { scope: AgentSession.cloneScope(record.scope) } : {}),
			...(telemetry ? { telemetry } : {}),
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		};
	}

	public static cloneState(state: AgentSessionState): AgentSessionState {
		const telemetry = AgentSession.cloneTelemetry(state.telemetry);
		return {
			runnerId: state.runnerId,
			...(state.transportId ? { transportId: state.transportId } : {}),
			runnerLabel: state.runnerLabel,
			sessionId: state.sessionId,
			...(state.sessionLogPath ? { sessionLogPath: state.sessionLogPath } : {}),
			...(state.terminalSessionName ? { terminalSessionName: state.terminalSessionName } : {}),
			...(state.terminalPaneId ? { terminalPaneId: state.terminalPaneId } : {}),
			lifecycleState: state.lifecycleState,
			lastUpdatedAt: state.lastUpdatedAt,
			...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
			...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
			...(state.scope ? { scope: AgentSession.cloneScope(state.scope) } : {}),
			...(state.awaitingPermission
				? {
					awaitingPermission: {
						...state.awaitingPermission,
						options: [...state.awaitingPermission.options],
						...(state.awaitingPermission.providerDetails
							? { providerDetails: { ...state.awaitingPermission.providerDetails } }
							: {})
					}
				}
				: {}),
			...(telemetry ? { telemetry } : {}),
			...(state.failureMessage ? { failureMessage: state.failureMessage } : {})
		};
	}

	public static toLifecycleState(
		status: AgentSessionLaunchRecord['lifecycle']
	): AgentSessionRecord['lifecycleState'] {
		switch (status) {
			case 'awaiting-input':
				return 'awaiting-input';
			case 'completed':
				return 'completed';
			case 'failed':
				return 'failed';
			case 'cancelled':
				return 'cancelled';
			case 'terminated':
				return 'terminated';
			case 'running':
				return 'running';
			case 'starting':
				return 'starting';
			default:
				return 'running';
		}
	}

	public constructor(
		private readonly owner: AgentSessionOwner,
		private readonly record: AgentSessionRecord
	) { }

	public get sessionId(): string {
		return this.record.sessionId;
	}

	public toRecord(): AgentSessionRecord {
		return AgentSession.cloneRecord(this.record);
	}

	public toEntity(): AgentSessionData {
		return toAgentSession(this.record);
	}

	public toState(snapshot?: AgentSessionSnapshot): AgentSessionState {
		if (!snapshot) {
			return AgentSession.cloneState({
				runnerId: this.record.runnerId,
				...(this.record.transportId ? { transportId: this.record.transportId } : {}),
				runnerLabel: this.record.runnerLabel,
				sessionId: this.record.sessionId,
				...(this.record.terminalSessionName ? { terminalSessionName: this.record.terminalSessionName } : {}),
				...(this.record.terminalPaneId ? { terminalPaneId: this.record.terminalPaneId } : {}),
				lifecycleState: this.record.lifecycleState,
				lastUpdatedAt: this.record.lastUpdatedAt,
				...(this.record.workingDirectory ? { workingDirectory: this.record.workingDirectory } : {}),
				...(this.record.currentTurnTitle ? { currentTurnTitle: this.record.currentTurnTitle } : {}),
				...(this.record.scope ? { scope: this.record.scope } : {}),
				...(this.record.failureMessage ? { failureMessage: this.record.failureMessage } : {})
			});
		}

		return AgentSession.createStateFromSnapshot({
			snapshot,
			runnerLabel: this.record.runnerLabel,
			record: this.record
		});
	}

	public async sendPrompt(prompt: AgentPrompt): Promise<AgentSession> {
		const nextRecord = await this.owner.sendSessionPrompt(this.record.sessionId, prompt);
		return new AgentSession(this.owner, nextRecord);
	}

	public async sendCommand(command: AgentCommand): Promise<AgentSession> {
		const nextRecord = await this.owner.sendSessionCommand(this.record.sessionId, command);
		return new AgentSession(this.owner, nextRecord);
	}

	public async done(): Promise<AgentSession> {
		const nextRecord = await this.owner.completeSessionRecord(this.record.sessionId);
		return new AgentSession(this.owner, nextRecord);
	}

	public async cancel(reason?: string): Promise<AgentSession> {
		const nextRecord = await this.owner.cancelSessionRecord(this.record.sessionId, reason);
		return new AgentSession(this.owner, nextRecord);
	}

	public async terminate(reason?: string): Promise<AgentSession> {
		const nextRecord = await this.owner.terminateSessionRecord(this.record.sessionId, reason);
		return new AgentSession(this.owner, nextRecord);
	}

	private static cloneModel(model: MissionAgentModelInfo | undefined): MissionAgentModelInfo | undefined {
		if (!model) {
			return undefined;
		}

		return {
			...(model.id ? { id: model.id } : {}),
			...(model.family ? { family: model.family } : {}),
			...(model.provider ? { provider: model.provider } : {}),
			...(model.displayName ? { displayName: model.displayName } : {})
		};
	}

	private static cloneTelemetry(
		telemetry: MissionAgentTelemetrySnapshot | undefined
	): MissionAgentTelemetrySnapshot | undefined {
		if (!telemetry) {
			return undefined;
		}

		const model = AgentSession.cloneModel(telemetry.model);

		return {
			...(model ? { model } : {}),
			...(telemetry.providerSessionId ? { providerSessionId: telemetry.providerSessionId } : {}),
			...(telemetry.tokenUsage ? { tokenUsage: { ...telemetry.tokenUsage } } : {}),
			...(telemetry.contextWindow ? { contextWindow: { ...telemetry.contextWindow } } : {}),
			...(telemetry.estimatedCostUsd !== undefined ? { estimatedCostUsd: telemetry.estimatedCostUsd } : {}),
			...(telemetry.activeToolName ? { activeToolName: telemetry.activeToolName } : {}),
			updatedAt: telemetry.updatedAt
		};
	}

	private static cloneScope(scope: MissionAgentScope): MissionAgentScope {
		switch (scope.kind) {
			case 'control':
				return {
					kind: 'control',
					...(scope.workspaceRoot ? { workspaceRoot: scope.workspaceRoot } : {}),
					...(scope.repoName ? { repoName: scope.repoName } : {}),
					...(scope.branch ? { branch: scope.branch } : {})
				};
			case 'mission':
				return {
					kind: 'mission',
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.currentSlice ? { currentSlice: scope.currentSlice } : {}),
					...(scope.readyTaskIds ? { readyTaskIds: [...scope.readyTaskIds] } : {}),
					...(scope.readyTaskTitle ? { readyTaskTitle: scope.readyTaskTitle } : {}),
					...(scope.readyTaskInstruction ? { readyTaskInstruction: scope.readyTaskInstruction } : {})
				};
			case 'artifact':
				return {
					kind: 'artifact',
					artifactKey: scope.artifactKey,
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.artifactPath ? { artifactPath: scope.artifactPath } : {}),
					...(scope.checkpoint ? { checkpoint: scope.checkpoint } : {}),
					...(scope.validation ? { validation: scope.validation } : {})
				};
			case 'slice':
				return {
					kind: 'slice',
					sliceTitle: scope.sliceTitle,
					verificationTargets: [...scope.verificationTargets],
					requiredSkills: [...scope.requiredSkills],
					dependsOn: [...scope.dependsOn],
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.missionDir ? { missionDir: scope.missionDir } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.sliceId ? { sliceId: scope.sliceId } : {}),
					...(scope.taskId ? { taskId: scope.taskId } : {}),
					...(scope.taskTitle ? { taskTitle: scope.taskTitle } : {}),
					...(scope.taskSummary ? { taskSummary: scope.taskSummary } : {}),
					...(scope.taskInstruction ? { taskInstruction: scope.taskInstruction } : {}),
					...(scope.doneWhen ? { doneWhen: [...scope.doneWhen] } : {}),
					...(scope.stopCondition ? { stopCondition: scope.stopCondition } : {})
				};
			case 'gate':
				return {
					kind: 'gate',
					intent: scope.intent,
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {})
				};
		}
	}
}

function getTransportFields(snapshot: AgentSessionSnapshot | undefined): {
	transportId?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
} {
	if (snapshot?.transport?.kind !== 'terminal') {
		return {};
	}
	return {
		transportId: 'terminal',
		terminalSessionName: snapshot.transport.terminalSessionName,
		...(snapshot.transport.paneId ? { terminalPaneId: snapshot.transport.paneId } : {})
	};
}

async function loadMissionDaemon(context: EntityExecutionContext) {
	const { requireMissionDaemon } = await import('../../daemon/MissionDaemon.js');
	return requireMissionDaemon(context);
}
