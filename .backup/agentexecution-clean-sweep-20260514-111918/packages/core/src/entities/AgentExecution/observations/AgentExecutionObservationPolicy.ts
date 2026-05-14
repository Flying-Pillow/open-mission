import {
	MAX_AGENT_EXECUTION_MESSAGE_LENGTH,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	MAX_AGENT_SIGNAL_MARKER_LENGTH,
	MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES,
	MAX_AGENT_EXECUTION_USAGE_ENTRIES,
	type AgentExecutionDiagnosticCode,
	isScalarAgentMetadataValue,
	sameObservationAddress,
	type AgentExecutionObservation,
	type AgentExecutionObservationAddress,
	type AgentExecutionInputChoice,
	type AgentExecutionSignal,
	type AgentExecutionSignalDecision,
	type AgentExecutionProcess
} from '../AgentExecutionSchema.js';
import {
	deriveAttentionFromStatusSignalPhase,
	deriveLifecycleStateFromStatusSignalPhase
} from '../activity/AgentExecutionActivityState.js';
import { projectAgentExecutionObservationSignalToTimelineItem } from './AgentExecutionObservationSignalRegistry.js';

export class AgentExecutionObservationLedger {
	private readonly observedIds = new Set<string>();

	public constructor(observationIds?: Iterable<string>) {
		if (observationIds) {
			this.recordMany(observationIds);
		}
	}

	public has(observationId: string): boolean {
		return this.observedIds.has(observationId);
	}

	public record(observationId: string): void {
		this.observedIds.add(observationId);
	}

	public recordMany(observationIds: Iterable<string>): void {
		for (const observationId of observationIds) {
			this.record(observationId);
		}
	}
}

export class AgentExecutionObservationPolicy {
	private readonly observationLedger: AgentExecutionObservationLedger;

	public constructor(observationLedger = new AgentExecutionObservationLedger()) {
		this.observationLedger = observationLedger;
	}

	public evaluate(input: {
		execution: AgentExecutionProcess;
		observation: AgentExecutionObservation;
	}): AgentExecutionSignalDecision {
		const rejection = this.validateObservation(input.execution, input.observation);
		if (rejection) {
			return { action: 'reject', reason: rejection };
		}
		this.observationLedger.record(input.observation.observationId);
		return this.decide(input.execution, input.observation);
	}

	private validateObservation(
		execution: AgentExecutionProcess,
		observation: AgentExecutionObservation
	): string | undefined {
		if (!observation.observationId.trim()) {
			return 'Observation id must not be empty.';
		}
		if (this.observationLedger.has(observation.observationId)) {
			return `Observation '${observation.observationId}' was already processed.`;
		}
		const activeAddress: AgentExecutionObservationAddress = {
			agentExecutionId: execution.agentExecutionId,
			ownerId: execution.ownerId
		};
		if (!sameObservationAddress(observation.route.address, activeAddress)) {
			return 'Observation route address did not match the active Agent execution.';
		}
		if (observation.claimedAddress && !sameObservationAddress(observation.claimedAddress, activeAddress)) {
			return 'Agent signal address did not match the active Agent execution.';
		}
		const sourceBoundaryError = validateObservationSourceBoundary(observation);
		if (sourceBoundaryError) {
			return sourceBoundaryError;
		}
		const typeBoundaryError = validateObservationTypeBoundary(observation);
		if (typeBoundaryError) {
			return typeBoundaryError;
		}
		const confidenceBoundaryError = validateObservationConfidenceBoundary(observation);
		if (confidenceBoundaryError) {
			return confidenceBoundaryError;
		}
		const payloadBoundaryError = validateObservationPayloadBoundary(observation);
		if (payloadBoundaryError) {
			return payloadBoundaryError;
		}
		const claimBoundaryError = validateClaimBoundary(observation);
		if (claimBoundaryError) {
			return claimBoundaryError;
		}
		const lifecycleBoundaryError = validateAgentExecutionLifecycleBoundary(execution, observation);
		if (lifecycleBoundaryError) {
			return lifecycleBoundaryError;
		}
		return validateSignalShape(observation.signal);
	}

	private decide(snapshot: AgentExecutionProcess, observation: AgentExecutionObservation): AgentExecutionSignalDecision {
		const signal = observation.signal;
		const preservesInputRequest = hasActiveInputRequest(snapshot);
		switch (signal.type) {
			case 'diagnostic':
				return { action: 'record-observation-only', reason: 'Diagnostic signals never mutate AgentExecution state.' };
			case 'usage':
				return { action: 'record-observation-only', reason: 'Usage signals are audit metadata, not workflow truth.' };
			case 'message':
				const timelineItem = projectAgentExecutionObservationSignalToTimelineItem({
					itemId: observation.observationId,
					occurredAt: observation.observedAt,
					signal,
					provenance: {
						durable: false,
						sourceRecordIds: [],
						liveOverlay: true,
						confidence: signal.confidence
					}
				});
				return {
					action: 'emit-message',
					event: {
						type: 'execution.message',
						channel: signal.channel,
						text: signal.text,
						...(timelineItem ? { timelineItem } : {}),
						execution: snapshot
					}
				};
			case 'progress':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence progress stayed observational only.' };
				}
				return {
					action: 'update-execution',
					eventType: 'execution.updated',
					patch: {
						status: 'running',
						attention: preservesInputRequest ? 'awaiting-operator' : 'autonomous',
						progress: {
							state: 'working',
							summary: signal.summary,
							...(signal.detail ? { detail: signal.detail } : {}),
							updatedAt: observation.observedAt
						}
					}
				};
			case 'status':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence status stayed observational only.' };
				}
				return {
					action: 'update-execution',
					eventType: 'execution.updated',
					patch: {
						status: deriveLifecycleStateFromStatusSignalPhase(signal.phase),
						attention: deriveAttentionFromStatusSignalPhase({
							phase: signal.phase,
							preservesInputRequest
						}),
						progress: {
							state: signal.phase,
							summary: signal.summary ?? defaultStatusSummary(signal.phase),
							updatedAt: observation.observedAt
						}
					}
				};
			case 'needs_input':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence needs-input stayed observational only.' };
				}
				return {
					action: 'update-execution',
					eventType: 'execution.updated',
					patch: {
						status: 'running',
						attention: 'awaiting-operator',
						currentInputRequestId: observation.observationId,
						waitingForInput: true,
						progress: {
							state: 'waiting-input',
							summary: signal.question,
							detail: `Choices: ${formatInputChoices(signal.choices)}`,
							updatedAt: observation.observedAt
						}
					}
				};
			case 'blocked':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence blocked state stayed observational only.' };
				}
				return {
					action: 'update-execution',
					eventType: 'execution.updated',
					patch: {
						status: 'running',
						attention: 'awaiting-system',
						waitingForInput: false,
						progress: {
							state: 'blocked',
							summary: signal.reason,
							updatedAt: observation.observedAt
						}
					}
				};
			case 'ready_for_verification':
				return {
					action: 'record-observation-only',
					reason: 'Ready-for-verification claims are not deterministic verification authority.'
				};
			case 'completed_claim':
				if (!isAuthoritativeLifecycleClaim(signal)) {
					return {
						action: 'record-observation-only',
						reason: 'Completion claims stay observational unless the daemon is authoritative.'
					};
				}
				return {
					action: 'update-execution',
					eventType: 'execution.completed',
					patch: {
						status: 'completed',
						attention: 'none',
						waitingForInput: false,
						progress: {
							state: 'done',
							summary: signal.summary,
							updatedAt: observation.observedAt
						},
						endedAt: observation.observedAt
					}
				};
			case 'failed_claim':
				if (!isAuthoritativeLifecycleClaim(signal)) {
					return {
						action: 'record-observation-only',
						reason: 'Failure claims stay observational unless the daemon is authoritative.'
					};
				}
				return {
					action: 'update-execution',
					eventType: 'execution.failed',
					patch: {
						status: 'failed',
						attention: 'awaiting-system',
						waitingForInput: false,
						progress: {
							state: 'failed',
							summary: signal.reason,
							updatedAt: observation.observedAt
						},
						failureMessage: signal.reason,
						endedAt: observation.observedAt
					}
				};
		}
	}
}

function validateSignalShape(signal: AgentExecutionSignal): string | undefined {
	switch (signal.type) {
		case 'progress':
			return validateText(signal.summary, 'progress summary')
				?? validateOptionalText(signal.detail, 'progress detail');
		case 'status':
			return validateOptionalText(signal.summary, 'status summary');
		case 'needs_input':
			return validateText(signal.question, 'needs-input question')
				?? validateInputChoices(signal.choices);
		case 'blocked':
			return validateText(signal.reason, 'blocked reason');
		case 'ready_for_verification':
		case 'completed_claim':
			return validateText(signal.summary, `${signal.type} summary`);
		case 'failed_claim':
			return validateText(signal.reason, 'failed reason');
		case 'message':
			return validateMessage(signal.text);
		case 'usage':
			return validateUsagePayload(signal.payload);
		case 'diagnostic':
			return validateText(signal.summary, 'diagnostic summary')
				?? validateOptionalText(signal.detail, 'diagnostic detail')
				?? (signal.payload ? validateUsagePayload(signal.payload) : undefined);
	}
}

function validateText(value: string, label: string): string | undefined {
	if (!value.trim()) {
		return `${label} must not be empty.`;
	}
	if (value.length > MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH) {
		return `${label} exceeded the maximum supported length.`;
	}
	return undefined;
}

function validateOptionalText(value: string | undefined, label: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return validateText(value, label);
}

function validateMessage(value: string): string | undefined {
	if (!value.trim()) {
		return 'message text must not be empty.';
	}
	if (value.length > MAX_AGENT_EXECUTION_MESSAGE_LENGTH) {
		return 'message text exceeded the maximum supported length.';
	}
	return undefined;
}

function validateInputChoices(value: AgentExecutionInputChoice[]): string | undefined {
	if (value.length === 0) {
		return 'needs-input choices must include at least one fixed or manual choice.';
	}
	if (value.length > MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES) {
		return 'needs-input choices exceeded the maximum supported size.';
	}
	for (const choice of value) {
		const labelError = validateText(choice.label, 'needs-input choice label');
		if (labelError) {
			return labelError;
		}
		if (choice.kind === 'fixed') {
			const valueError = validateText(choice.value, 'needs-input fixed choice value');
			if (valueError) {
				return valueError;
			}
			continue;
		}
		const placeholderError = validateOptionalText(choice.placeholder, 'needs-input manual choice placeholder');
		if (placeholderError) {
			return placeholderError;
		}
	}
	return undefined;
}

function formatInputChoices(choices: AgentExecutionInputChoice[]): string {
	return choices.map((choice) => {
		if (choice.kind === 'fixed') {
			return `${choice.label}=${choice.value}`;
		}
		return choice.placeholder ? `${choice.label}=manual (${choice.placeholder})` : `${choice.label}=manual`;
	}).join(', ');
}

function defaultStatusSummary(phase: 'initializing' | 'idle'): string {
	return phase === 'initializing'
		? 'Initializing the next agent turn.'
		: 'Idle and ready for the next structured prompt.';
}

function validateUsagePayload(payload: Record<string, unknown>): string | undefined {
	const entries = Object.entries(payload);
	if (entries.length > MAX_AGENT_EXECUTION_USAGE_ENTRIES) {
		return 'usage payload exceeded the maximum supported size.';
	}
	for (const [key, value] of entries) {
		if (!key.trim()) {
			return 'usage payload keys must not be empty.';
		}
		if (!isScalarAgentMetadataValue(value)) {
			return `usage payload entry '${key}' must be a scalar metadata value.`;
		}
	}
	return undefined;
}

function isPromotableProgressSignal(
	signal: Extract<AgentExecutionSignal, { type: 'progress' | 'status' | 'needs_input' | 'blocked' }>
): boolean {
	return signal.confidence !== 'low'
		&& signal.confidence !== 'diagnostic';
}

function hasActiveInputRequest(snapshot: AgentExecutionProcess): boolean {
	return snapshot.currentInputRequestId !== undefined && snapshot.currentInputRequestId !== null;
}

function isAuthoritativeLifecycleClaim(
	signal: Extract<AgentExecutionSignal, { type: 'completed_claim' | 'failed_claim' }>
): boolean {
	return signal.source === 'daemon-authoritative' && signal.confidence === 'authoritative';
}

function validateObservationSourceBoundary(observation: AgentExecutionObservation): string | undefined {
	const expectedSourceByOrigin = {
		daemon: 'daemon-authoritative',
		'provider-output': 'provider-structured',
		'agent-signal': 'agent-signal',
		'terminal-output': 'terminal-heuristic'
	} as const;
	const expectedSource = expectedSourceByOrigin[observation.route.origin];
	if (observation.signal.source !== expectedSource) {
		return `Observation origin '${observation.route.origin}' requires signal source '${expectedSource}'.`;
	}
	return undefined;
}

function validateObservationTypeBoundary(observation: AgentExecutionObservation): string | undefined {
	const allowedTypesByOrigin: Record<
		AgentExecutionObservation['route']['origin'],
		readonly AgentExecutionSignal['type'][]
	> = {
		daemon: [
			'progress',
			'status',
			'needs_input',
			'blocked',
			'ready_for_verification',
			'completed_claim',
			'failed_claim',
			'message',
			'usage',
			'diagnostic'
		],
		'provider-output': ['message', 'usage', 'diagnostic'],
		'agent-signal': [
			'progress',
			'status',
			'needs_input',
			'blocked',
			'ready_for_verification',
			'completed_claim',
			'failed_claim',
			'message',
			'diagnostic'
		],
		'terminal-output': ['diagnostic']
	};
	if (!allowedTypesByOrigin[observation.route.origin].includes(observation.signal.type)) {
		return `Observation origin '${observation.route.origin}' does not allow signal type '${observation.signal.type}'.`;
	}
	if (observation.signal.type !== 'diagnostic') {
		return undefined;
	}

	const allowedDiagnosticCodesByOrigin: Record<
		AgentExecutionObservation['route']['origin'],
		readonly AgentExecutionDiagnosticCode[] | undefined
	> = {
		daemon: undefined,
		'provider-output': ['provider-execution', 'tool-call'],
		'agent-signal': ['agent-signal-malformed', 'agent-signal-oversized'],
		'terminal-output': ['terminal-heuristic']
	};
	const allowedCodes = allowedDiagnosticCodesByOrigin[observation.route.origin];
	if (!allowedCodes || allowedCodes.includes(observation.signal.code)) {
		return undefined;
	}
	return `Observation origin '${observation.route.origin}' does not allow diagnostic code '${observation.signal.code}'.`;
}

function validateClaimBoundary(observation: AgentExecutionObservation): string | undefined {
	if (
		observation.route.origin === 'agent-signal'
		&& observation.signal.type !== 'diagnostic'
		&& !observation.claimedAddress
	) {
		return 'Agent signal observations must carry a claimed Agent execution address.';
	}
	return undefined;
}

function validateObservationPayloadBoundary(observation: AgentExecutionObservation): string | undefined {
	if (
		observation.route.origin === 'agent-signal'
		&& observation.signal.type !== 'diagnostic'
		&& observation.rawText
		&& observation.rawText.trimEnd().length > MAX_AGENT_SIGNAL_MARKER_LENGTH
	) {
		return 'Agent signal marker exceeded the maximum length.';
	}
	return undefined;
}

function validateAgentExecutionLifecycleBoundary(
	snapshot: AgentExecutionProcess,
	observation: AgentExecutionObservation
): string | undefined {
	if (snapshot.status !== 'completed' && snapshot.status !== 'failed') {
		return undefined;
	}
	if (
		observation.signal.type === 'diagnostic'
		|| observation.signal.type === 'usage'
		|| observation.signal.type === 'message'
	) {
		return undefined;
	}
	return `Agent execution '${snapshot.agentExecutionId}' already ended with status '${snapshot.status}'.`;
}

function validateObservationConfidenceBoundary(observation: AgentExecutionObservation): string | undefined {
	if (observation.route.origin === 'daemon') {
		if (observation.signal.confidence !== 'authoritative') {
			return "Observation origin 'daemon' requires signal confidence 'authoritative'.";
		}
	}
	if (observation.route.origin === 'provider-output') {
		if (observation.signal.type === 'diagnostic') {
			const expectedConfidence = observation.signal.code === 'provider-execution'
				? 'high'
				: observation.signal.code === 'tool-call'
					? 'medium'
					: undefined;
			if (!expectedConfidence) {
				return `Observation origin 'provider-output' does not allow diagnostic code '${observation.signal.code}'.`;
			}
			if (observation.signal.confidence !== expectedConfidence) {
				return `Observation origin 'provider-output' requires diagnostic code '${observation.signal.code}' to use signal confidence '${expectedConfidence}'.`;
			}
			return undefined;
		}
		if (observation.signal.confidence !== 'high') {
			return "Observation origin 'provider-output' requires signal confidence 'high'.";
		}
	}
	if (observation.route.origin === 'agent-signal') {
		const expectedConfidence = observation.signal.type === 'diagnostic' ? 'diagnostic' : 'medium';
		if (observation.signal.confidence !== expectedConfidence) {
			return `Observation origin 'agent-signal' requires signal confidence '${expectedConfidence}'.`;
		}
	}
	if (observation.route.origin === 'terminal-output') {
		if (observation.signal.confidence !== 'diagnostic') {
			return "Observation origin 'terminal-output' requires signal confidence 'diagnostic'.";
		}
	}
	return undefined;
}
