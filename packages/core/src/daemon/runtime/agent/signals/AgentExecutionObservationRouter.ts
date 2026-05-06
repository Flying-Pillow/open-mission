import { randomUUID } from 'node:crypto';
import type { AgentProviderObservation } from './AgentProviderObservation.js';
import {
	cloneSignal,
	cloneSignalScope,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	type AgentExecutionObservation,
	type AgentExecutionObservationOrigin,
	type AgentExecutionSignal,
	type AgentExecutionSignalCandidate,
	type AgentExecutionSignalScope
} from './AgentExecutionSignal.js';
import {
	MISSION_PROTOCOL_MARKER_PREFIX,
	MissionProtocolMarkerParser
} from './MissionProtocolMarkerParser.js';
import { ProviderOutputSignalParser } from './ProviderOutputSignalParser.js';

const NEEDS_INPUT_PATTERNS = [
	/\b(waiting for input|awaiting input|needs input|need input)\b/i,
	/\b(enter|type|provide|confirm|choose|select)\b.+\b(to continue|to proceed|response|yes|no)\b/i
];
const BLOCKED_PATTERNS = [
	/\bblocked\b/i,
	/\bcannot continue\b/i,
	/\bpermission denied\b/i,
	/\bmissing\b.+\b(token|credential|permission|input)\b/i
];
const PROGRESS_PATTERNS = [
	/\bprogress\b/i,
	/\bworking\b/i,
	/\bcompleted \d+\/\d+\b/i,
	/\bprocessing\b/i
];

export type AgentExecutionObservationInput =
	| {
		kind: 'provider-output';
		observation: AgentProviderObservation;
		scope: AgentExecutionSignalScope;
		observedAt?: string;
	}
	| {
		kind: 'mcp-signal';
		signal: AgentExecutionSignal;
		scope: AgentExecutionSignalScope;
		dedupeKey?: string;
		claimedScope?: AgentExecutionSignalScope;
		rawText?: string;
		observedAt?: string;
	}
	| {
		kind: 'protocol-marker';
		line: string;
		scope: AgentExecutionSignalScope;
		observedAt?: string;
	}
	| {
		kind: 'terminal-output';
		line: string;
		channel: 'stdout' | 'stderr';
		scope: AgentExecutionSignalScope;
		observedAt?: string;
	};

export class AgentExecutionObservationRouter {
	private readonly providerOutputParser: ProviderOutputSignalParser;

	private readonly protocolMarkerParser: MissionProtocolMarkerParser;

	public constructor(options?: {
		providerOutputParser?: ProviderOutputSignalParser;
		protocolMarkerParser?: MissionProtocolMarkerParser;
	}) {
		this.providerOutputParser = options?.providerOutputParser ?? new ProviderOutputSignalParser();
		this.protocolMarkerParser = options?.protocolMarkerParser ?? new MissionProtocolMarkerParser();
	}

	public route(input: AgentExecutionObservationInput): AgentExecutionObservation[] {
		const observedAt = input.observedAt ?? new Date().toISOString();
		if (input.kind === 'provider-output') {
			return this.toObservations(
				this.providerOutputParser.parse(input.observation),
				'provider-output',
				input.scope,
				observedAt
			);
		}
		if (input.kind === 'mcp-signal') {
			return this.toObservations(
				[{
					signal: input.signal,
					...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
					...(input.claimedScope ? { claimedScope: input.claimedScope } : {}),
					...(input.rawText ? { rawText: input.rawText } : {})
				}],
				'mcp',
				input.scope,
				observedAt
			);
		}
		if (input.kind === 'protocol-marker') {
			return this.toObservations(
				this.protocolMarkerParser.parse(input.line),
				'protocol-marker',
				input.scope,
				observedAt
			);
		}

		const markerCandidates = input.channel === 'stdout'
			? this.protocolMarkerParser.parse(input.line)
			: [];
		if (markerCandidates.length > 0) {
			return this.toObservations(markerCandidates, 'protocol-marker', input.scope, observedAt);
		}
		if (input.line.startsWith(MISSION_PROTOCOL_MARKER_PREFIX)) {
			return [];
		}
		return this.toObservations(
			this.detectTerminalHeuristics(input.line, input.channel),
			'terminal-output',
			input.scope,
			observedAt
		);
	}

	private detectTerminalHeuristics(
		line: string,
		channel: 'stdout' | 'stderr'
	): AgentExecutionSignalCandidate[] {
		const trimmed = line.trim();
		if (!trimmed) {
			return [];
		}
		if (NEEDS_INPUT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-needs-input:${trimmed.toLowerCase()}`,
				line,
				channel,
				heuristic: 'needs_input',
				summary: 'Terminal output suggested the agent is waiting for operator input.'
			})];
		}
		if (BLOCKED_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-blocked:${trimmed.toLowerCase()}`,
				line,
				channel,
				heuristic: 'blocked',
				summary: 'Terminal output suggested the agent is blocked.'
			})];
		}
		if (PROGRESS_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-progress:${trimmed.toLowerCase()}`,
				line,
				channel,
				heuristic: 'progress',
				summary: 'Terminal output suggested the agent is making progress.'
			})];
		}
		return [];
	}

	private createTerminalHeuristicDiagnostic(input: {
		dedupeKey: string;
		line: string;
		channel: 'stdout' | 'stderr';
		heuristic: 'progress' | 'needs_input' | 'blocked';
		summary: string;
	}): AgentExecutionSignalCandidate {
		return {
			dedupeKey: input.dedupeKey,
			rawText: input.line,
			signal: {
				type: 'diagnostic',
				code: 'terminal-heuristic',
				summary: input.summary,
				detail: toBoundedSignalText(input.line.trim()),
				payload: {
					heuristic: input.heuristic,
					channel: input.channel
				},
				source: 'terminal-heuristic',
				confidence: 'diagnostic'
			}
		};
	}

	private toObservations(
		candidates: AgentExecutionSignalCandidate[],
		origin: AgentExecutionObservationOrigin,
		scope: AgentExecutionSignalScope,
		observedAt: string
	): AgentExecutionObservation[] {
		return candidates.map((candidate, index) => ({
			observationId: candidate.dedupeKey
				? `${origin}:${candidate.dedupeKey}`
				: `${origin}:${createEphemeralObservationId({
					index,
					observedAt,
					signal: candidate.signal,
					...(candidate.rawText ? { rawText: candidate.rawText } : {})
				})}`,
			observedAt,
			signal: cloneSignal(candidate.signal),
			route: {
				origin,
				scope: cloneSignalScope(scope)
			},
			...(candidate.claimedScope ? { claimedScope: cloneSignalScope(candidate.claimedScope) } : {}),
			...(candidate.rawText ? { rawText: candidate.rawText } : {})
		}));
	}
}

function createEphemeralObservationId(payload: {
	index: number;
	observedAt: string;
	rawText?: string;
	signal: AgentExecutionSignal;
}): string {
	const fingerprint = stableHash(JSON.stringify(payload));
	return `${fingerprint}:${randomUUID()}`;
}

function stableHash(value: string): string {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(16);
}

function toBoundedSignalText(value: string): string {
	if (value.length <= MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH) {
		return value;
	}
	return value.slice(0, MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH - 1).trimEnd();
}
