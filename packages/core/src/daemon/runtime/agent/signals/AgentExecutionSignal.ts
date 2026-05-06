import type {
	AgentMetadata,
	AgentExecutionEvent,
	AgentExecutionSnapshot
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export const MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH = 2_000;
export const MAX_AGENT_EXECUTION_MESSAGE_LENGTH = 8_000;
export const MAX_AGENT_EXECUTION_USAGE_ENTRIES = 32;
export const MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES = 6;
export const MAX_MISSION_PROTOCOL_MARKER_LENGTH = 4_096;

export type AgentExecutionSignalSource =
	| 'daemon-authoritative'
	| 'provider-structured'
	| 'agent-declared'
	| 'terminal-heuristic';

export type AgentExecutionSignalConfidence =
	| 'authoritative'
	| 'high'
	| 'medium'
	| 'low'
	| 'diagnostic';

type AgentExecutionSignalBase = {
	source: AgentExecutionSignalSource;
	confidence: AgentExecutionSignalConfidence;
};

export type AgentExecutionDiagnosticCode =
	| 'provider-session'
	| 'tool-call'
	| 'protocol-marker-malformed'
	| 'protocol-marker-oversized'
	| 'terminal-heuristic';

export type AgentExecutionSignal =
	| ({
		type: 'progress';
		summary: string;
		detail?: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'needs_input';
		question: string;
		suggestedResponses?: string[];
	} & AgentExecutionSignalBase)
	| ({
		type: 'blocked';
		reason: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'ready_for_verification';
		summary: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'completed_claim';
		summary: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'failed_claim';
		reason: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'message';
		channel: 'agent' | 'system' | 'stdout' | 'stderr';
		text: string;
	} & AgentExecutionSignalBase)
	| ({
		type: 'usage';
		payload: AgentMetadata;
	} & AgentExecutionSignalBase)
	| ({
		type: 'diagnostic';
		code: AgentExecutionDiagnosticCode;
		summary: string;
		detail?: string;
		payload?: AgentMetadata;
	} & AgentExecutionSignalBase);

export type AgentExecutionSignalScope = {
	missionId: string;
	taskId: string;
	agentExecutionId: string;
};

export type AgentExecutionObservationOrigin =
	| 'daemon'
	| 'provider-output'
	| 'protocol-marker'
	| 'terminal-output';

export type AgentExecutionSignalCandidate = {
	signal: AgentExecutionSignal;
	dedupeKey?: string;
	claimedScope?: AgentExecutionSignalScope;
	rawText?: string;
};

export type AgentExecutionObservation = {
	observationId: string;
	observedAt: string;
	signal: AgentExecutionSignal;
	route: {
		origin: AgentExecutionObservationOrigin;
		scope: AgentExecutionSignalScope;
	};
	claimedScope?: AgentExecutionSignalScope;
	rawText?: string;
};

export type AgentExecutionSignalDecision =
	| { action: 'reject'; reason: string }
	| { action: 'record-observation-only'; reason: string }
	| { action: 'emit-message'; event: AgentExecutionEvent }
	| {
		action: 'update-session';
		eventType: 'execution.updated' | 'execution.awaiting-input' | 'execution.completed' | 'execution.failed';
		snapshotPatch: Partial<AgentExecutionSnapshot>;
	};

export function cloneSignalScope(scope: AgentExecutionSignalScope): AgentExecutionSignalScope {
	return {
		missionId: scope.missionId,
		taskId: scope.taskId,
		agentExecutionId: scope.agentExecutionId
	};
}

export function sameSignalScope(
	left: AgentExecutionSignalScope,
	right: AgentExecutionSignalScope
): boolean {
	return left.missionId === right.missionId
		&& left.taskId === right.taskId
		&& left.agentExecutionId === right.agentExecutionId;
}

export function cloneSignal(signal: AgentExecutionSignal): AgentExecutionSignal {
	switch (signal.type) {
		case 'progress':
			return {
				...signal,
				...(signal.detail ? { detail: signal.detail } : {})
			};
		case 'needs_input':
			return {
				...signal,
				...(signal.suggestedResponses ? { suggestedResponses: [...signal.suggestedResponses] } : {})
			};
		case 'blocked':
		case 'ready_for_verification':
		case 'completed_claim':
		case 'failed_claim':
		case 'message':
			return { ...signal };
		case 'usage':
			return {
				...signal,
				payload: { ...signal.payload }
			};
		case 'diagnostic':
			return {
				...signal,
				...(signal.payload ? { payload: { ...signal.payload } } : {})
			};
	}
}

export function isScalarAgentMetadataValue(value: unknown): value is AgentMetadata[string] {
	return value === null
		|| typeof value === 'string'
		|| typeof value === 'number'
		|| typeof value === 'boolean';
}
