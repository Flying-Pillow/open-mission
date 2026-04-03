/**
 * @file packages/core/src/daemon/MissionAgentRuntime.ts
 * @description Declares provider-neutral agent runtime contracts, normalized events, and session metadata helpers.
 */

export type MissionAgentPrimitiveValue = string | number | boolean | null;

export type MissionAgentDisposable = {
	dispose(): void;
};

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
	| 'cancelled';

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

export type MissionAgentRuntimeCapabilities = {
	persistentSessions: boolean;
	interactiveInput: boolean;
	scopedPrompts: boolean;
	resumableSessions: boolean;
	toolPermissionRequests: boolean;
	contextWindowVisibility: boolean;
	tokenUsageVisibility: boolean;
	costVisibility: boolean;
	customInstructions: boolean;
	telemetry: boolean;
	interruptible: boolean;
};

export type MissionAgentScope =
	| {
			kind: 'control';
			repoRoot?: string;
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

export type MissionAgentRuntimeAvailability = {
	available: boolean;
	detail?: string;
};

export type MissionAgentSessionState = {
	runtimeId: string;
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

export interface MissionAgentSession extends MissionAgentDisposable {
	readonly runtimeId: string;
	readonly sessionId: string;
	readonly capabilities: MissionAgentRuntimeCapabilities;
	readonly onDidConsoleEvent: (
		listener: (event: MissionAgentConsoleEvent) => void
	) => MissionAgentDisposable;
	readonly onDidEvent: (
		listener: (event: MissionAgentEvent) => void
	) => MissionAgentDisposable;
	getConsoleState(): MissionAgentConsoleState;
	getSessionState(): MissionAgentSessionState;
	submitTurn(request: MissionAgentTurnRequest): Promise<void>;
	sendInput(text: string): Promise<void>;
	resize?(dimensions: { cols: number; rows: number }): Promise<void>;
	cancel(reason?: string): Promise<void>;
	terminate(reason?: string): Promise<void>;
}

export interface MissionAgentRuntime {
	readonly id: string;
	readonly displayName: string;
	readonly capabilities: MissionAgentRuntimeCapabilities;
	isAvailable(): Promise<MissionAgentRuntimeAvailability>;
	createSession(): Promise<MissionAgentSession>;
	resumeSession?(sessionId: string): Promise<MissionAgentSession>;
}

export class MissionAgentEventEmitter<T> implements MissionAgentDisposable {
	private readonly listeners = new Set<(event: T) => void>();

	public readonly event = (listener: (event: T) => void): MissionAgentDisposable => {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			}
		};
	};

	public fire(event: T): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	public dispose(): void {
		this.listeners.clear();
	}
}

export function cloneMissionAgentModelInfo(model: MissionAgentModelInfo): MissionAgentModelInfo;
export function cloneMissionAgentModelInfo(model: undefined): undefined;
export function cloneMissionAgentModelInfo(
	model: MissionAgentModelInfo | undefined
): MissionAgentModelInfo | undefined {
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

export function cloneMissionAgentScope(scope: MissionAgentScope): MissionAgentScope;
export function cloneMissionAgentScope(scope: undefined): undefined;
export function cloneMissionAgentScope(
	scope: MissionAgentScope | undefined
): MissionAgentScope | undefined {
	if (!scope) {
		return undefined;
	}

	switch (scope.kind) {
		case 'control':
			return {
				kind: 'control',
				...(scope.repoRoot ? { repoRoot: scope.repoRoot } : {}),
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

export function cloneMissionAgentConsoleState(
	state: MissionAgentConsoleState
): MissionAgentConsoleState {
	return {
		lines: [...state.lines],
		promptOptions: state.promptOptions ? [...state.promptOptions] : null,
		awaitingInput: state.awaitingInput,
		...(state.title ? { title: state.title } : {}),
		...(state.runtimeId ? { runtimeId: state.runtimeId } : {}),
		...(state.runtimeLabel ? { runtimeLabel: state.runtimeLabel } : {}),
		...(state.sessionId ? { sessionId: state.sessionId } : {})
	};
}

export function createEmptyMissionAgentConsoleState(
	overrides: Partial<MissionAgentConsoleState> = {}
): MissionAgentConsoleState {
	return {
		lines: overrides.lines ? [...overrides.lines] : [],
		promptOptions: overrides.promptOptions ? [...overrides.promptOptions] : null,
		awaitingInput: overrides.awaitingInput ?? false,
		...(overrides.title ? { title: overrides.title } : {}),
		...(overrides.runtimeId ? { runtimeId: overrides.runtimeId } : {}),
		...(overrides.runtimeLabel ? { runtimeLabel: overrides.runtimeLabel } : {}),
		...(overrides.sessionId ? { sessionId: overrides.sessionId } : {})
	};
}

export function cloneMissionAgentTelemetrySnapshot(
	telemetry: MissionAgentTelemetrySnapshot
): MissionAgentTelemetrySnapshot;
export function cloneMissionAgentTelemetrySnapshot(telemetry: undefined): undefined;
export function cloneMissionAgentTelemetrySnapshot(
	telemetry: MissionAgentTelemetrySnapshot | undefined
): MissionAgentTelemetrySnapshot | undefined {
	if (!telemetry) {
		return undefined;
	}

	return {
		...(telemetry.model ? { model: cloneMissionAgentModelInfo(telemetry.model) } : {}),
		...(telemetry.providerSessionId ? { providerSessionId: telemetry.providerSessionId } : {}),
		...(telemetry.tokenUsage ? { tokenUsage: { ...telemetry.tokenUsage } } : {}),
		...(telemetry.contextWindow ? { contextWindow: { ...telemetry.contextWindow } } : {}),
		...(telemetry.estimatedCostUsd !== undefined
			? { estimatedCostUsd: telemetry.estimatedCostUsd }
			: {}),
		...(telemetry.activeToolName ? { activeToolName: telemetry.activeToolName } : {}),
		updatedAt: telemetry.updatedAt
	};
}

export function cloneMissionAgentPermissionRequest(
	request: MissionAgentPermissionRequest
): MissionAgentPermissionRequest;
export function cloneMissionAgentPermissionRequest(request: undefined): undefined;
export function cloneMissionAgentPermissionRequest(
	request: MissionAgentPermissionRequest | undefined
): MissionAgentPermissionRequest | undefined {
	if (!request) {
		return undefined;
	}

	return {
		id: request.id,
		kind: request.kind,
		prompt: request.prompt,
		options: [...request.options],
		...(request.providerDetails ? { providerDetails: { ...request.providerDetails } } : {})
	};
}

export function cloneMissionAgentSessionState(
	state: MissionAgentSessionState
): MissionAgentSessionState {
	return {
		runtimeId: state.runtimeId,
		runtimeLabel: state.runtimeLabel,
		sessionId: state.sessionId,
		lifecycleState: state.lifecycleState,
		...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
		...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
		...(state.scope ? { scope: cloneMissionAgentScope(state.scope) } : {}),
		...(state.awaitingPermission
			? { awaitingPermission: cloneMissionAgentPermissionRequest(state.awaitingPermission) }
			: {}),
		...(state.telemetry
			? { telemetry: cloneMissionAgentTelemetrySnapshot(state.telemetry) }
			: {}),
		...(state.failureMessage ? { failureMessage: state.failureMessage } : {}),
		lastUpdatedAt: state.lastUpdatedAt
	};
}

export function createEmptyMissionAgentSessionState(
	overrides: Partial<MissionAgentSessionState> &
		Pick<MissionAgentSessionState, 'runtimeId' | 'runtimeLabel' | 'sessionId'>
): MissionAgentSessionState {
	return {
		runtimeId: overrides.runtimeId,
		runtimeLabel: overrides.runtimeLabel,
		sessionId: overrides.sessionId,
		lifecycleState: overrides.lifecycleState ?? 'idle',
		...(overrides.workingDirectory ? { workingDirectory: overrides.workingDirectory } : {}),
		...(overrides.currentTurnTitle ? { currentTurnTitle: overrides.currentTurnTitle } : {}),
		...(overrides.scope ? { scope: cloneMissionAgentScope(overrides.scope) } : {}),
		...(overrides.awaitingPermission
			? { awaitingPermission: cloneMissionAgentPermissionRequest(overrides.awaitingPermission) }
			: {}),
		...(overrides.telemetry
			? { telemetry: cloneMissionAgentTelemetrySnapshot(overrides.telemetry) }
			: {}),
		...(overrides.failureMessage ? { failureMessage: overrides.failureMessage } : {}),
		lastUpdatedAt: overrides.lastUpdatedAt ?? new Date().toISOString()
	};
}

export function cloneMissionAgentSessionRecord(
	record: MissionAgentSessionRecord
): MissionAgentSessionRecord {
	return {
		sessionId: record.sessionId,
		runtimeId: record.runtimeId,
		runtimeLabel: record.runtimeLabel,
		lifecycleState: record.lifecycleState,
		...(record.taskId ? { taskId: record.taskId } : {}),
		...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
		...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
		...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
		...(record.scope ? { scope: cloneMissionAgentScope(record.scope) } : {}),
		...(record.telemetry
			? { telemetry: cloneMissionAgentTelemetrySnapshot(record.telemetry) }
			: {}),
		...(record.failureMessage ? { failureMessage: record.failureMessage } : {}),
		createdAt: record.createdAt,
		lastUpdatedAt: record.lastUpdatedAt
	};
}

export function createMissionAgentSessionRecord(
	state: MissionAgentSessionState,
	overrides: {
		taskId?: string;
		assignmentLabel?: string;
		createdAt?: string;
	} = {}
): MissionAgentSessionRecord {
	return {
		sessionId: state.sessionId,
		runtimeId: state.runtimeId,
		runtimeLabel: state.runtimeLabel,
		lifecycleState: state.lifecycleState,
		...(overrides.taskId ? { taskId: overrides.taskId } : {}),
		...(overrides.assignmentLabel ? { assignmentLabel: overrides.assignmentLabel } : {}),
		...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
		...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
		...(state.scope ? { scope: cloneMissionAgentScope(state.scope) } : {}),
		...(state.telemetry ? { telemetry: cloneMissionAgentTelemetrySnapshot(state.telemetry) } : {}),
		...(state.failureMessage ? { failureMessage: state.failureMessage } : {}),
		createdAt: overrides.createdAt ?? state.lastUpdatedAt,
		lastUpdatedAt: state.lastUpdatedAt
	};
}

export function renderMissionAgentPrompt(request: MissionAgentTurnRequest): string {
	const prompt = request.prompt.trim();
	const scopeLines = renderMissionAgentScope(request.scope);
	const headerLines = request.operatorIntent
		? [...scopeLines, `Operator intent: ${request.operatorIntent}`]
		: scopeLines;

	if (headerLines.length === 0) {
		return prompt;
	}

	return [...headerLines, '', `Mission request: ${prompt}`].join('\n');
}

export function renderMissionAgentScope(scope: MissionAgentScope | undefined): string[] {
	if (!scope) {
		return [];
	}

	switch (scope.kind) {
		case 'control':
			return [
				'Scope: control',
				scope.repoName ? `Repository: ${scope.repoName}` : '',
				scope.repoRoot ? `Repository root: ${scope.repoRoot}` : '',
				scope.branch ? `Branch: ${scope.branch}` : ''
			].filter(Boolean);
		case 'mission':
			return [
				'Scope: mission',
				`Mission: ${scope.missionId ?? 'unknown'}`,
				`Stage: ${scope.stage ?? 'unknown'}`,
				`Current flight: ${scope.currentSlice ?? 'none recorded'}`,
				`Ready task: ${scope.readyTaskTitle ?? 'none recorded'}`,
				scope.readyTaskInstruction
					? `Ready task instruction: ${scope.readyTaskInstruction}`
					: ''
			];
		case 'artifact':
			return [
				'Scope: artifact',
				`Mission: ${scope.missionId ?? 'unknown'}`,
				`Stage: ${scope.stage ?? 'unknown'}`,
				`Artifact: ${scope.artifactKey}`,
				`Checkpoint: ${scope.checkpoint ?? 'unknown'}`,
				`Validation: ${scope.validation ?? 'unknown'}`,
				`Path: ${scope.artifactPath ?? 'unavailable'}`
			];
		case 'slice':
			return [
				'Scope: flight',
				`Mission: ${scope.missionId ?? 'unknown'}`,
				scope.missionDir ? `Mission folder: ${scope.missionDir}` : '',
				`Stage: ${scope.stage ?? 'unknown'}`,
				`Flight: ${scope.sliceTitle}`,
				scope.sliceId ? `Flight id: ${scope.sliceId}` : '',
				scope.taskId ? `Task id: ${scope.taskId}` : '',
				scope.taskTitle ? `Task: ${scope.taskTitle}` : '',
				scope.taskSummary ? `Task summary: ${scope.taskSummary}` : '',
				scope.taskInstruction ? `Task instruction: ${scope.taskInstruction}` : '',
				scope.doneWhen?.length ? `Done when: ${scope.doneWhen.join(' | ')}` : '',
				scope.stopCondition ? `Stop condition: ${scope.stopCondition}` : '',
				`Verification targets: ${scope.verificationTargets.length ? scope.verificationTargets.join(' | ') : 'none recorded'}`,
				`Required skills: ${scope.requiredSkills.length ? scope.requiredSkills.join(', ') : 'none recorded'}`,
				`Depends on: ${scope.dependsOn.length ? scope.dependsOn.join(', ') : 'none recorded'}`
			].filter(Boolean);
		case 'gate':
			return [
				'Scope: gate',
				`Mission: ${scope.missionId ?? 'unknown'}`,
				`Stage: ${scope.stage ?? 'unknown'}`,
				`Gate intent: ${scope.intent}`
			];
	}
}