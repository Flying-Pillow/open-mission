import { z } from 'zod';
import {
	MAX_AGENT_EXECUTION_MESSAGE_LENGTH,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES,
	MAX_MISSION_PROTOCOL_MARKER_LENGTH,
	type AgentExecutionSignalCandidate,
	type AgentExecutionSignalScope
} from './AgentExecutionSignal.js';

export const MISSION_PROTOCOL_MARKER_PREFIX = 'mission::';

const boundedText = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH);

const scopeSchema = z.object({
	missionId: boundedText,
	taskId: boundedText,
	agentExecutionId: boundedText
}).strict();

const signalSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('progress'),
		summary: boundedText,
		detail: boundedText.optional()
	}).strict(),
	z.object({
		type: z.literal('needs_input'),
		question: boundedText,
		suggestedResponses: z.array(boundedText).max(MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES).optional()
	}).strict(),
	z.object({
		type: z.literal('blocked'),
		reason: boundedText
	}).strict(),
	z.object({
		type: z.literal('ready_for_verification'),
		summary: boundedText
	}).strict(),
	z.object({
		type: z.literal('completed_claim'),
		summary: boundedText
	}).strict(),
	z.object({
		type: z.literal('failed_claim'),
		reason: boundedText
	}).strict(),
	z.object({
		type: z.literal('message'),
		channel: z.enum(['agent', 'system', 'stdout', 'stderr']),
		text: z.string().trim().min(1).max(MAX_AGENT_EXECUTION_MESSAGE_LENGTH)
	}).strict()
]);

const markerSchema = z.object({
	version: z.literal(1),
	missionId: boundedText,
	taskId: boundedText,
	agentExecutionId: boundedText,
	eventId: boundedText,
	signal: signalSchema
}).strict();

export class MissionProtocolMarkerParser {
	public parse(line: string): AgentExecutionSignalCandidate[] {
		const trimmed = line.trimEnd();
		if (!trimmed.startsWith(MISSION_PROTOCOL_MARKER_PREFIX)) {
			return [];
		}
		if (trimmed.length > MAX_MISSION_PROTOCOL_MARKER_LENGTH) {
			return [this.createDiagnostic(
				'protocol-marker-oversized',
				'Mission protocol marker exceeded the maximum length.',
				line
			)];
		}
		const payload = trimmed.slice(MISSION_PROTOCOL_MARKER_PREFIX.length);
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return [this.createDiagnostic(
				'protocol-marker-malformed',
				'Mission protocol marker did not contain valid JSON.',
				line
			)];
		}
		const result = markerSchema.safeParse(parsed);
		if (!result.success) {
			return [
				this.createDiagnostic(
					'protocol-marker-malformed',
					'Mission protocol marker failed schema validation.',
					line,
					result.error.issues[0]?.message
				)
			];
		}

		const claimedScope: AgentExecutionSignalScope = scopeSchema.parse({
			missionId: result.data.missionId,
			taskId: result.data.taskId,
			agentExecutionId: result.data.agentExecutionId
		});

		return [{
			dedupeKey: result.data.eventId,
			claimedScope,
			rawText: line,
			signal: toAgentDeclaredSignal(result.data.signal)
		}];
	}

	private createDiagnostic(
		code: 'protocol-marker-malformed' | 'protocol-marker-oversized',
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
				source: 'agent-declared',
				confidence: 'diagnostic'
			}
		};
	}
}

function toAgentDeclaredSignal(signal: z.infer<typeof signalSchema>): AgentExecutionSignalCandidate['signal'] {
	switch (signal.type) {
		case 'progress':
			return {
				type: 'progress',
				summary: signal.summary,
				...(signal.detail ? { detail: signal.detail } : {}),
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'needs_input':
			return {
				type: 'needs_input',
				question: signal.question,
				...(signal.suggestedResponses ? { suggestedResponses: [...signal.suggestedResponses] } : {}),
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'blocked':
			return {
				type: 'blocked',
				reason: signal.reason,
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'ready_for_verification':
			return {
				type: 'ready_for_verification',
				summary: signal.summary,
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'completed_claim':
			return {
				type: 'completed_claim',
				summary: signal.summary,
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'failed_claim':
			return {
				type: 'failed_claim',
				reason: signal.reason,
				source: 'agent-declared',
				confidence: 'medium'
			};
		case 'message':
			return {
				type: 'message',
				channel: signal.channel,
				text: signal.text,
				source: 'agent-declared',
				confidence: 'medium'
			};
	}
}
