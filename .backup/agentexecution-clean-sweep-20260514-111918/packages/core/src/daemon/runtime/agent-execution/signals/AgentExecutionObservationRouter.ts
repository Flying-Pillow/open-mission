import { randomUUID } from 'node:crypto';
import type { AgentAdapterProcessOutput } from '../adapter/AgentAdapter.js';
import {
	cloneSignal,
	cloneObservationAddress,
	type AgentExecutionObservation,
	type AgentExecutionObservationOrigin,
	type AgentExecutionSignal,
	type AgentExecutionSignalCandidate,
	type AgentExecutionObservationAddress
} from '../../../../entities/AgentExecution/AgentExecutionSchema.js';
import { createAgentExecutionSignalFromPayload } from '../../../../entities/AgentExecution/observations/AgentExecutionObservationSignalRegistry.js';
import {
	AgentSignalMarkerPayloadSchema,
	MAX_AGENT_SIGNAL_MARKER_LENGTH,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	AgentExecutionSignalMarkerPrefixSchema,
	type AgentExecutionSignalMarkerPrefixType
} from '../../../../entities/AgentExecution/AgentExecutionCommunicationSchema.js';
import { sanitizeTerminalTextForHeuristics } from '../../terminal/TerminalTextSanitizer.js';

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

type AgentExecutionObservationDebugLogger = {
	debug(message: string, metadata?: Record<string, unknown>): void;
};

type TerminalHeuristicKind = 'progress' | 'needs_input' | 'blocked';

export type AgentExecutionObservationInput =
	| {
		kind: 'provider-output';
		observation: AgentAdapterProcessOutput;
		address: AgentExecutionObservationAddress;
		observedAt?: string;
	}
	| {
		kind: 'agent-signal';
		line: string;
		address: AgentExecutionObservationAddress;
		markerPrefix: AgentExecutionSignalMarkerPrefixType;
		observedAt?: string;
	}
	| {
		kind: 'terminal-output';
		line: string;
		channel: 'stdout' | 'stderr';
		address: AgentExecutionObservationAddress;
		markerPrefix?: AgentExecutionSignalMarkerPrefixType;
		observedAt?: string;
	};

export class AgentExecutionObservationRouter {
	private readonly logger: AgentExecutionObservationDebugLogger | undefined;

	public constructor(options: { logger?: AgentExecutionObservationDebugLogger } = {}) {
		this.logger = options.logger;
		this.logger?.debug('Agent execution observation patterns active.', {
			markerPrefixes: [AgentExecutionSignalMarkerPrefixSchema.value],
			needsInputPatterns: NEEDS_INPUT_PATTERNS.map((pattern) => pattern.source),
			blockedPatterns: BLOCKED_PATTERNS.map((pattern) => pattern.source),
			progressPatterns: PROGRESS_PATTERNS.map((pattern) => pattern.source)
		});
	}

	public route(input: AgentExecutionObservationInput): AgentExecutionObservation[] {
		const observedAt = input.observedAt ?? new Date().toISOString();
		if (input.kind === 'provider-output') {
			return this.toObservations(
				parseAdapterProcessOutput(input.observation),
				'provider-output',
				input.address,
				observedAt
			);
		}
		if (input.kind === 'agent-signal') {
			return this.toObservations(
				this.parseAgentSignals(input.line, input.markerPrefix),
				'agent-signal',
				input.address,
				observedAt
			);
		}

		const markerCandidates = input.channel === 'stdout' && input.markerPrefix
			? this.parseAgentSignals(input.line, input.markerPrefix)
			: [];
		if (markerCandidates.length > 0) {
			return this.toObservations(markerCandidates, 'agent-signal', input.address, observedAt);
		}
		if (isAgentSignalMarkerLine(input.line)) {
			return [];
		}
		return this.toObservations(
			this.detectTerminalHeuristics(input.line, input.channel),
			'terminal-output',
			input.address,
			observedAt
		);
	}

	private detectTerminalHeuristics(
		line: string,
		channel: 'stdout' | 'stderr'
	): AgentExecutionSignalCandidate[] {
		const heuristicText = sanitizeTerminalTextForHeuristics(line);
		if (!heuristicText) {
			return [];
		}
		const needsInputPattern = NEEDS_INPUT_PATTERNS.find((pattern) => pattern.test(heuristicText));
		if (needsInputPattern) {
			this.logTerminalHeuristicPatternMatch({
				pattern: needsInputPattern,
				line: heuristicText,
				channel,
				heuristic: 'needs_input'
			});
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-needs-input:${heuristicText.toLowerCase()}`,
				rawText: line,
				detail: heuristicText,
				channel,
				heuristic: 'needs_input',
				summary: 'Terminal output suggested the agent is waiting for operator input.'
			})];
		}
		const blockedPattern = BLOCKED_PATTERNS.find((pattern) => pattern.test(heuristicText));
		if (blockedPattern) {
			this.logTerminalHeuristicPatternMatch({
				pattern: blockedPattern,
				line: heuristicText,
				channel,
				heuristic: 'blocked'
			});
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-blocked:${heuristicText.toLowerCase()}`,
				rawText: line,
				detail: heuristicText,
				channel,
				heuristic: 'blocked',
				summary: 'Terminal output suggested the agent is blocked.'
			})];
		}
		const progressPattern = PROGRESS_PATTERNS.find((pattern) => pattern.test(heuristicText));
		if (progressPattern) {
			this.logTerminalHeuristicPatternMatch({
				pattern: progressPattern,
				line: heuristicText,
				channel,
				heuristic: 'progress'
			});
			return [this.createTerminalHeuristicDiagnostic({
				dedupeKey: `heuristic-progress:${heuristicText.toLowerCase()}`,
				rawText: line,
				detail: heuristicText,
				channel,
				heuristic: 'progress',
				summary: 'Terminal output suggested the agent is making progress.'
			})];
		}
		return [];
	}

	private logTerminalHeuristicPatternMatch(input: {
		pattern: RegExp;
		line: string;
		channel: 'stdout' | 'stderr';
		heuristic: TerminalHeuristicKind;
	}): void {
		this.logger?.debug('Agent execution terminal heuristic pattern matched.', {
			heuristic: input.heuristic,
			channel: input.channel,
			pattern: input.pattern.source,
			line: toBoundedSignalText(input.line)
		});
	}

	private parseAgentSignals(
		line: string,
		markerPrefix: AgentExecutionSignalMarkerPrefixType
	): AgentExecutionSignalCandidate[] {
		const trimmed = line.trimEnd();
		if (!trimmed.startsWith(markerPrefix)) {
			return [];
		}
		if (trimmed.length > MAX_AGENT_SIGNAL_MARKER_LENGTH) {
			return [this.createAgentSignalDiagnostic(
				'agent-signal-oversized',
				'Agent signal marker exceeded the maximum length.',
				line
			)];
		}
		const payload = trimmed.slice(markerPrefix.length);
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return [this.createAgentSignalDiagnostic(
				'agent-signal-malformed',
				'Agent signal marker did not contain valid JSON.',
				line
			)];
		}
		const result = AgentSignalMarkerPayloadSchema.safeParse(parsed);
		if (!result.success) {
			return [this.createAgentSignalDiagnostic(
				'agent-signal-malformed',
				'Agent signal marker failed schema validation.',
				line,
				result.error.issues[0]?.message
			)];
		}

		return [{
			dedupeKey: result.data.eventId,
			claimedAgentExecutionId: result.data.agentExecutionId,
			rawText: line,
			signal: createAgentExecutionSignalFromPayload(result.data.signal)
		}];
	}

	private createAgentSignalDiagnostic(
		code: 'agent-signal-malformed' | 'agent-signal-oversized',
		summary: string,
		rawText: string,
		detail?: string
	): AgentExecutionSignalCandidate {
		return {
			rawText,
			signal: {
				type: 'diagnostic',
				code,
				summary,
				...(detail ? { detail } : {}),
				source: 'agent-signal',
				confidence: 'diagnostic'
			}
		};
	}

	private createTerminalHeuristicDiagnostic(input: {
		dedupeKey: string;
		rawText: string;
		detail: string;
		channel: 'stdout' | 'stderr';
		heuristic: TerminalHeuristicKind;
		summary: string;
	}): AgentExecutionSignalCandidate {
		return {
			dedupeKey: input.dedupeKey,
			rawText: input.rawText,
			signal: {
				type: 'diagnostic',
				code: 'terminal-heuristic',
				summary: input.summary,
				detail: toBoundedSignalText(input.detail),
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
		address: AgentExecutionObservationAddress,
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
				address: cloneObservationAddress(address)
			},
			...(candidate.claimedAddress
				? { claimedAddress: cloneObservationAddress(candidate.claimedAddress) }
				: candidate.claimedAgentExecutionId
					? {
						claimedAddress: {
							agentExecutionId: candidate.claimedAgentExecutionId,
							ownerId: cloneObservationAddress(address).ownerId
						}
					}
					: {}),
			...(candidate.rawText ? { rawText: candidate.rawText } : {})
		}));
	}
}

function isAgentSignalMarkerLine(line: string): boolean {
	return line.startsWith(AgentExecutionSignalMarkerPrefixSchema.value);
}

function parseAdapterProcessOutput(observation: AgentAdapterProcessOutput): AgentExecutionSignalCandidate[] {
	switch (observation.kind) {
		case 'message':
			return [{
				signal: {
					type: 'message',
					channel: observation.channel,
					text: observation.text,
					source: 'provider-structured',
					confidence: 'high'
				}
			}];
		case 'usage':
			return [{
				signal: {
					type: 'usage',
					payload: { ...observation.payload },
					source: 'provider-structured',
					confidence: 'high'
				}
			}];
		case 'signal':
			return [toProviderDiagnosticCandidate(observation)];
		case 'none':
			return [];
	}
}

function toProviderDiagnosticCandidate(observation: Extract<AgentAdapterProcessOutput, { kind: 'signal' }>): AgentExecutionSignalCandidate {
	if (observation.signal.type === 'provider-execution') {
		return {
			dedupeKey: `provider-execution:${observation.signal.providerName}:${observation.signal.agentExecutionId}`,
			signal: {
				type: 'diagnostic',
				code: 'provider-execution',
				summary: `Provider '${observation.signal.providerName}' reported execution '${observation.signal.agentExecutionId}'.`,
				payload: {
					providerName: observation.signal.providerName,
					agentExecutionId: observation.signal.agentExecutionId
				},
				source: observation.signal.source,
				confidence: observation.signal.confidence
			}
		};
	}

	return {
		dedupeKey: `tool-call:${observation.signal.toolName}:${observation.signal.args}`,
		signal: {
			type: 'diagnostic',
			code: 'tool-call',
			summary: `Provider invoked tool '${observation.signal.toolName}'.`,
			detail: observation.signal.args,
			payload: {
				toolName: observation.signal.toolName,
				args: observation.signal.args
			},
			source: observation.signal.source,
			confidence: observation.signal.confidence
		}
	};
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
