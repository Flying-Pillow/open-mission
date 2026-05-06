import {
	MAX_AGENT_EXECUTION_MESSAGE_LENGTH,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	MAX_MISSION_PROTOCOL_MARKER_LENGTH,
	MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES,
	MAX_AGENT_EXECUTION_USAGE_ENTRIES,
	type AgentExecutionDiagnosticCode,
	isScalarAgentMetadataValue,
	sameSignalScope,
	type AgentExecutionObservation,
	type AgentExecutionSignal,
	type AgentExecutionSignalDecision
} from './AgentExecutionSignal.js';
import type { AgentExecutionSnapshot } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export class AgentExecutionSignalPolicy {
	private readonly seenObservationIds = new Set<string>();

	public evaluate(input: {
		snapshot: AgentExecutionSnapshot;
		observation: AgentExecutionObservation;
	}): AgentExecutionSignalDecision {
		const rejection = this.validateObservation(input.snapshot, input.observation);
		if (rejection) {
			return { action: 'reject', reason: rejection };
		}
		this.seenObservationIds.add(input.observation.observationId);
		return this.decide(input.snapshot, input.observation);
	}

	private validateObservation(
		snapshot: AgentExecutionSnapshot,
		observation: AgentExecutionObservation
	): string | undefined {
		if (!observation.observationId.trim()) {
			return 'Observation id must not be empty.';
		}
		if (this.seenObservationIds.has(observation.observationId)) {
			return `Observation '${observation.observationId}' was already processed.`;
		}
		if (!snapshot.missionId || !snapshot.taskId) {
			return 'Mission protocol signals require a task-scoped Agent execution.';
		}
		const activeScope = {
			missionId: snapshot.missionId,
			taskId: snapshot.taskId,
			agentExecutionId: snapshot.sessionId
		};
		if (!sameSignalScope(observation.route.scope, activeScope)) {
			return 'Observation route scope did not match the active Mission execution.';
		}
		if (observation.claimedScope && !sameSignalScope(observation.claimedScope, activeScope)) {
			return 'Signal scope did not match the active Mission execution.';
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
		const lifecycleBoundaryError = validateSessionLifecycleBoundary(snapshot, observation);
		if (lifecycleBoundaryError) {
			return lifecycleBoundaryError;
		}
		return validateSignalShape(observation.signal);
	}

	private decide(snapshot: AgentExecutionSnapshot, observation: AgentExecutionObservation): AgentExecutionSignalDecision {
		const signal = observation.signal;
		switch (signal.type) {
			case 'diagnostic':
				return { action: 'record-observation-only', reason: 'Diagnostic signals never mutate session state.' };
			case 'usage':
				return { action: 'record-observation-only', reason: 'Usage signals are audit metadata, not workflow truth.' };
			case 'message':
				return {
					action: 'emit-message',
					event: {
						type: 'execution.message',
						channel: signal.channel,
						text: signal.text,
						snapshot
					}
				};
			case 'progress':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence progress stayed observational only.' };
				}
				return {
					action: 'update-session',
					eventType: 'execution.updated',
					snapshotPatch: {
						status: 'running',
						attention: 'autonomous',
						waitingForInput: false,
						progress: {
							state: 'working',
							summary: signal.summary,
							...(signal.detail ? { detail: signal.detail } : {}),
							updatedAt: observation.observedAt
						}
					}
				};
			case 'needs_input':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence needs-input stayed observational only.' };
				}
				return {
					action: 'update-session',
					eventType: 'execution.awaiting-input',
					snapshotPatch: {
						status: 'awaiting-input',
						attention: 'awaiting-operator',
						waitingForInput: true,
						progress: {
							state: 'waiting-input',
							summary: signal.question,
							...(signal.suggestedResponses?.length
								? { detail: `Suggested responses: ${signal.suggestedResponses.join(', ')}` }
								: {}),
							updatedAt: observation.observedAt
						}
					}
				};
			case 'blocked':
				if (!isPromotableProgressSignal(signal)) {
					return { action: 'record-observation-only', reason: 'Low-confidence blocked state stayed observational only.' };
				}
				return {
					action: 'update-session',
					eventType: 'execution.updated',
					snapshotPatch: {
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
					action: 'update-session',
					eventType: 'execution.completed',
					snapshotPatch: {
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
					action: 'update-session',
					eventType: 'execution.failed',
					snapshotPatch: {
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
		case 'needs_input':
			return validateText(signal.question, 'needs-input question')
				?? validateSuggestedResponses(signal.suggestedResponses);
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

function validateSuggestedResponses(value: string[] | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	if (value.length > MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES) {
		return 'suggested responses exceeded the maximum supported size.';
	}
	for (const response of value) {
		const error = validateText(response, 'suggested response');
		if (error) {
			return error;
		}
	}
	return undefined;
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
	signal: Extract<AgentExecutionSignal, { type: 'progress' | 'needs_input' | 'blocked' }>
): boolean {
	return signal.confidence !== 'low'
		&& signal.confidence !== 'diagnostic';
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
		'protocol-marker': 'agent-declared',
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
		'protocol-marker': [
			'progress',
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
		'provider-output': ['provider-session', 'tool-call'],
		'protocol-marker': ['protocol-marker-malformed', 'protocol-marker-oversized'],
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
		observation.route.origin === 'protocol-marker'
		&& observation.signal.type !== 'diagnostic'
		&& !observation.claimedScope
	) {
		return 'Protocol-marker observations must carry a claimed Mission scope.';
	}
	return undefined;
}

function validateObservationPayloadBoundary(observation: AgentExecutionObservation): string | undefined {
	if (
		observation.route.origin === 'protocol-marker'
		&& observation.signal.type !== 'diagnostic'
		&& observation.rawText
		&& observation.rawText.trimEnd().length > MAX_MISSION_PROTOCOL_MARKER_LENGTH
	) {
		return 'Mission protocol marker exceeded the maximum length.';
	}
	return undefined;
}

function validateSessionLifecycleBoundary(
	snapshot: AgentExecutionSnapshot,
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
	return `Agent execution '${snapshot.sessionId}' already ended with status '${snapshot.status}'.`;
}

function validateObservationConfidenceBoundary(observation: AgentExecutionObservation): string | undefined {
	if (observation.route.origin === 'daemon') {
		if (observation.signal.confidence !== 'authoritative') {
			return "Observation origin 'daemon' requires signal confidence 'authoritative'.";
		}
	}
	if (observation.route.origin === 'provider-output') {
		if (observation.signal.type === 'diagnostic') {
			const expectedConfidence = observation.signal.code === 'provider-session'
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
	if (observation.route.origin === 'protocol-marker') {
		const expectedConfidence = observation.signal.type === 'diagnostic' ? 'diagnostic' : 'medium';
		if (observation.signal.confidence !== expectedConfidence) {
			return `Observation origin 'protocol-marker' requires signal confidence '${expectedConfidence}'.`;
		}
	}
	if (observation.route.origin === 'terminal-output') {
		if (observation.signal.confidence !== 'diagnostic') {
			return "Observation origin 'terminal-output' requires signal confidence 'diagnostic'.";
		}
	}
	return undefined;
}
