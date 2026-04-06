import type {
	AgentCommand,
	AgentPrompt,
	AgentSessionSnapshot
} from '../../runtime/AgentRuntimeTypes.js';
import type { MissionTaskState } from '../../types.js';
import type {
	MissionAgentModelInfo,
	MissionAgentScope,
	MissionAgentSessionRecord,
	MissionAgentSessionState,
	MissionAgentTelemetrySnapshot
} from '../contracts.js';

export type MissionSessionOwner = {
	cancelSessionRecord(sessionId: string, reason?: string): Promise<MissionAgentSessionRecord>;
	terminateSessionRecord(sessionId: string, reason?: string): Promise<MissionAgentSessionRecord>;
	sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<MissionAgentSessionRecord>;
	sendSessionCommand(sessionId: string, command: AgentCommand): Promise<MissionAgentSessionRecord>;
};

type MissionRuntimeSessionRecord = {
	sessionId: string;
	runtimeId: string;
	taskId: string;
	lifecycle: MissionAgentSessionRecord['lifecycleState'] | AgentSessionSnapshot['phase'];
	launchedAt: string;
	updatedAt: string;
};

export class MissionSession {
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

	public static createRecordFromRuntime(input: {
		runtime: MissionRuntimeSessionRecord;
		runtimeLabel: string;
		snapshot?: AgentSessionSnapshot;
		task?: MissionTaskState;
		missionId?: string;
		missionDir?: string;
	}): MissionAgentSessionRecord {
		const scope = input.task
			? MissionSession.buildTaskScope(input.task, input.missionId, input.missionDir)
			: undefined;

		return MissionSession.cloneRecord({
			sessionId: input.runtime.sessionId,
			runtimeId: input.runtime.runtimeId,
			runtimeLabel: input.runtimeLabel,
			lifecycleState: MissionSession.toLifecycleState(
				input.snapshot?.phase ?? input.runtime.lifecycle
			),
			createdAt: input.runtime.launchedAt,
			lastUpdatedAt: input.snapshot?.updatedAt ?? input.runtime.updatedAt,
			...(input.runtime.taskId ? { taskId: input.runtime.taskId } : {}),
			...(input.task?.relativePath ? { assignmentLabel: input.task.relativePath } : {}),
			...(input.snapshot?.workingDirectory ? { workingDirectory: input.snapshot.workingDirectory } : {}),
			...(input.task?.subject ? { currentTurnTitle: input.task.subject } : {}),
			...(scope ? { scope } : {}),
			...(input.snapshot?.failureMessage ? { failureMessage: input.snapshot.failureMessage } : {})
		});
	}

	public static createStateFromSnapshot(input: {
		snapshot: AgentSessionSnapshot;
		runtimeLabel: string;
		record?: MissionAgentSessionRecord;
	}): MissionAgentSessionState {
		const { snapshot, runtimeLabel, record } = input;
		return MissionSession.cloneState({
			runtimeId: snapshot.runnerId,
			runtimeLabel,
			sessionId: snapshot.sessionId,
			lifecycleState: MissionSession.toLifecycleState(snapshot.phase),
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

	public static cloneRecord(record: MissionAgentSessionRecord): MissionAgentSessionRecord {
		const telemetry = MissionSession.cloneTelemetry(record.telemetry);
		return {
			sessionId: record.sessionId,
			runtimeId: record.runtimeId,
			runtimeLabel: record.runtimeLabel,
			lifecycleState: record.lifecycleState,
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			...(record.scope ? { scope: MissionSession.cloneScope(record.scope) } : {}),
			...(telemetry ? { telemetry } : {}),
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		};
	}

	public static cloneState(state: MissionAgentSessionState): MissionAgentSessionState {
		const telemetry = MissionSession.cloneTelemetry(state.telemetry);
		return {
			runtimeId: state.runtimeId,
			runtimeLabel: state.runtimeLabel,
			sessionId: state.sessionId,
			lifecycleState: state.lifecycleState,
			lastUpdatedAt: state.lastUpdatedAt,
			...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
			...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
			...(state.scope ? { scope: MissionSession.cloneScope(state.scope) } : {}),
			...(state.awaitingPermission ? {
				awaitingPermission: {
					...state.awaitingPermission,
					options: [...state.awaitingPermission.options],
					...(state.awaitingPermission.providerDetails
						? { providerDetails: { ...state.awaitingPermission.providerDetails } }
						: {})
				}
			} : {}),
			...(telemetry ? { telemetry } : {}),
			...(state.failureMessage ? { failureMessage: state.failureMessage } : {})
		};
	}

	public static toLifecycleState(
		phase: MissionRuntimeSessionRecord['lifecycle']
	): MissionAgentSessionRecord['lifecycleState'] {
		switch (phase) {
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
		private readonly owner: MissionSessionOwner,
		private readonly record: MissionAgentSessionRecord
	) { }

	public get sessionId(): string {
		return this.record.sessionId;
	}

	public toRecord(): MissionAgentSessionRecord {
		return MissionSession.cloneRecord(this.record);
	}

	public toState(snapshot?: AgentSessionSnapshot): MissionAgentSessionState {
		if (!snapshot) {
			return MissionSession.cloneState({
				runtimeId: this.record.runtimeId,
				runtimeLabel: this.record.runtimeLabel,
				sessionId: this.record.sessionId,
				lifecycleState: this.record.lifecycleState,
				lastUpdatedAt: this.record.lastUpdatedAt,
				...(this.record.workingDirectory ? { workingDirectory: this.record.workingDirectory } : {}),
				...(this.record.currentTurnTitle ? { currentTurnTitle: this.record.currentTurnTitle } : {}),
				...(this.record.scope ? { scope: this.record.scope } : {}),
				...(this.record.failureMessage ? { failureMessage: this.record.failureMessage } : {})
			});
		}

		return MissionSession.createStateFromSnapshot({
			snapshot,
			runtimeLabel: this.record.runtimeLabel,
			record: this.record
		});
	}

	public async sendPrompt(prompt: AgentPrompt): Promise<MissionSession> {
		const nextRecord = await this.owner.sendSessionPrompt(this.record.sessionId, prompt);
		return new MissionSession(this.owner, nextRecord);
	}

	public async sendCommand(command: AgentCommand): Promise<MissionSession> {
		const nextRecord = await this.owner.sendSessionCommand(this.record.sessionId, command);
		return new MissionSession(this.owner, nextRecord);
	}

	public async cancel(reason?: string): Promise<MissionSession> {
		const nextRecord = await this.owner.cancelSessionRecord(this.record.sessionId, reason);
		return new MissionSession(this.owner, nextRecord);
	}

	public async terminate(reason?: string): Promise<MissionSession> {
		const nextRecord = await this.owner.terminateSessionRecord(this.record.sessionId, reason);
		return new MissionSession(this.owner, nextRecord);
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

		const model = MissionSession.cloneModel(telemetry.model);

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