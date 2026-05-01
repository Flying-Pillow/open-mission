import type {
	AgentCommand,
	AgentPrompt,
	AgentSessionSnapshot
} from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionTaskState } from '../../types.js';
import type {
	MissionAgentModelInfo,
	MissionAgentScope,
	AgentSessionLaunchRequest,
	AgentSessionRecord,
	AgentSessionState,
	MissionAgentTelemetrySnapshot
} from '../../daemon/protocol/contracts.js';
import {
	AgentSessionCommandAcknowledgementSchema,
	AgentSessionExecuteCommandInputSchema,
	AgentSessionLocatorSchema,
	AgentSessionSendCommandInputSchema,
	AgentSessionSendPromptInputSchema,
	AgentSessionSendTerminalInputSchema,
	AgentSessionTerminalSnapshotSchema,
	AgentSessionDataSchema,
	AgentSessionCommandIds,
	agentSessionEntityName,
	type AgentSessionDataType
} from './AgentSessionSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';

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

export function toAgentSession(record: AgentSessionRecord): AgentSessionDataType {
	return AgentSessionDataSchema.parse({
		sessionId: record.sessionId,
		runnerId: record.runnerId,
		...(record.transportId ? { transportId: record.transportId } : {}),
		...(record.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
		runnerLabel: record.runnerLabel,
		lifecycleState: record.lifecycleState,
		...(record.terminalSessionName ? { terminalSessionName: record.terminalSessionName } : {}),
		...(record.terminalPaneId ? { terminalPaneId: record.terminalPaneId } : {}),
		...(record.terminalSessionName && record.terminalPaneId
			? {
				terminalHandle: {
					sessionName: record.terminalSessionName,
					paneId: record.terminalPaneId
				}
			}
			: {}),
		...(record.taskId ? { taskId: record.taskId } : {}),
		...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
		...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
		...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
		...(record.scope ? { scope: record.scope } : {}),
		...(record.telemetry ? { telemetry: record.telemetry } : {}),
		createdAt: record.createdAt,
		lastUpdatedAt: record.lastUpdatedAt,
		...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
	});
}

export class AgentSession extends Entity<AgentSessionDataType, string> {
	public static override readonly entityName = agentSessionEntityName;

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = AgentSessionLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return AgentSession.requireData(await mission.buildMissionSnapshot(), input.sessionId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, sessionId: string) {
		const session = snapshot.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (!session) {
			throw new Error(`AgentSession '${sessionId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return AgentSessionDataSchema.parse(session);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<AgentSession> {
		const input = AgentSessionExecuteCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new AgentSession(AgentSession.requireData(await mission.buildMissionSnapshot(), input.sessionId));
		} finally {
			mission.dispose();
		}
	}

	public static async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = AgentSessionLocatorSchema.parse(payload);
		const { readAgentSessionTerminalState } = await import('../../daemon/AgentSessionTerminal.js');
		const state = await readAgentSessionTerminalState({
			surfacePath: context.surfacePath,
			selector: { missionId: input.missionId },
			sessionId: input.sessionId
		});
		if (!state) {
			throw new Error(`AgentSession terminal for '${input.sessionId}' is not available.`);
		}
		return AgentSessionTerminalSnapshotSchema.parse({
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


	public async executeCommand(payload: unknown, context: EntityExecutionContext) {
		const input = AgentSessionExecuteCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			AgentSession.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			switch (input.commandId) {
				case AgentSessionCommandIds.complete:
					await mission.completeAgentSession(input.sessionId);
					break;
				case AgentSessionCommandIds.cancel:
					await mission.cancelAgentSession(input.sessionId, service.getReason(input.input));
					break;
				case AgentSessionCommandIds.terminate:
					await mission.terminateAgentSession(input.sessionId, service.getReason(input.input));
					break;
				default:
					throw new Error(`AgentSession command '${input.commandId}' is not implemented in the daemon.`);
			}
			return AgentSessionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: agentSessionEntityName,
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
		const input = AgentSessionSendPromptInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			AgentSession.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			await mission.sendAgentSessionPrompt(input.sessionId, service.normalizeAgentPrompt(input.prompt));
			return AgentSessionCommandAcknowledgementSchema.parse({
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
		const input = AgentSessionSendCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			AgentSession.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			await mission.sendAgentSessionCommand(input.sessionId, service.normalizeAgentCommand(input.command));
			return AgentSessionCommandAcknowledgementSchema.parse({
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
		const input = AgentSessionSendTerminalInputSchema.parse(payload);
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
		return AgentSessionTerminalSnapshotSchema.parse({
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

	private readonly owner: AgentSessionOwner | undefined;
	private readonly record: AgentSessionRecord | undefined;

	public constructor(data: AgentSessionDataType);
	public constructor(owner: AgentSessionOwner, record: AgentSessionRecord);
	public constructor(ownerOrData: AgentSessionOwner | AgentSessionDataType, record?: AgentSessionRecord) {
		if (record) {
			super(toAgentSession(record));
			this.owner = ownerOrData as AgentSessionOwner;
			this.record = AgentSession.cloneRecord(record);
			return;
		}

		super(AgentSessionDataSchema.parse(ownerOrData));
		this.owner = undefined;
		this.record = undefined;
	}

	public get id(): string {
		return this.sessionId;
	}

	public get sessionId(): string {
		return this.record?.sessionId ?? this.toData().sessionId;
	}

	public toRecord(): AgentSessionRecord {
		return AgentSession.cloneRecord(this.requireRecord());
	}

	public toEntity(): AgentSessionDataType {
		return toAgentSession(this.requireRecord());
	}

	public toState(snapshot?: AgentSessionSnapshot): AgentSessionState {
		const record = this.requireRecord();
		if (!snapshot) {
			return AgentSession.cloneState({
				runnerId: record.runnerId,
				...(record.transportId ? { transportId: record.transportId } : {}),
				runnerLabel: record.runnerLabel,
				sessionId: record.sessionId,
				...(record.terminalSessionName ? { terminalSessionName: record.terminalSessionName } : {}),
				...(record.terminalPaneId ? { terminalPaneId: record.terminalPaneId } : {}),
				lifecycleState: record.lifecycleState,
				lastUpdatedAt: record.lastUpdatedAt,
				...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
				...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
				...(record.scope ? { scope: record.scope } : {}),
				...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
			});
		}

		return AgentSession.createStateFromSnapshot({
			snapshot,
			runnerLabel: record.runnerLabel,
			record
		});
	}

	public async sendPrompt(prompt: AgentPrompt): Promise<AgentSession> {
		const nextRecord = await this.requireOwner().sendSessionPrompt(this.sessionId, prompt);
		return new AgentSession(this.requireOwner(), nextRecord);
	}

	public async sendCommand(command: AgentCommand): Promise<AgentSession> {
		const nextRecord = await this.requireOwner().sendSessionCommand(this.sessionId, command);
		return new AgentSession(this.requireOwner(), nextRecord);
	}

	public async done(): Promise<AgentSession> {
		const nextRecord = await this.requireOwner().completeSessionRecord(this.sessionId);
		return new AgentSession(this.requireOwner(), nextRecord);
	}

	public async cancel(reason?: string): Promise<AgentSession> {
		const nextRecord = await this.requireOwner().cancelSessionRecord(this.sessionId, reason);
		return new AgentSession(this.requireOwner(), nextRecord);
	}

	public async terminate(reason?: string): Promise<AgentSession> {
		const nextRecord = await this.requireOwner().terminateSessionRecord(this.sessionId, reason);
		return new AgentSession(this.requireOwner(), nextRecord);
	}

	private requireOwner(): AgentSessionOwner {
		if (!this.owner) {
			throw new Error(`AgentSession '${this.sessionId}' is not attached to a Mission owner.`);
		}
		return this.owner;
	}

	private requireRecord(): AgentSessionRecord {
		if (!this.record) {
			throw new Error(`AgentSession '${this.sessionId}' is not attached to a Mission session record.`);
		}
		return this.record;
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

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}
