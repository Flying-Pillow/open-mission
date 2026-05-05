import { z } from 'zod/v4';
import type { AgentSessionSignalAcknowledgement } from '../signals/AgentSessionSignalPort.js';
import {
	MAX_AGENT_SESSION_MESSAGE_LENGTH,
	MAX_AGENT_SESSION_SIGNAL_TEXT_LENGTH,
	MAX_AGENT_SESSION_SUGGESTED_RESPONSES,
	MAX_AGENT_SESSION_USAGE_ENTRIES,
	isScalarAgentMetadataValue,
	type AgentSessionSignal
} from '../signals/AgentSessionSignal.js';

export const missionMcpSignalToolNames = [
	'mission_report_progress',
	'mission_request_operator_input',
	'mission_report_blocked',
	'mission_report_ready_for_verification',
	'mission_report_completion_claim',
	'mission_report_failure_claim',
	'mission_append_session_note',
	'mission_report_usage'
] as const;

export type MissionMcpSignalToolName = (typeof missionMcpSignalToolNames)[number];

export const missionMcpSignalToolNameSchema = z.enum(missionMcpSignalToolNames);

export type MissionMcpSignalEnvelope = {
	missionId: string;
	taskId: string;
	agentSessionId: string;
	eventId: string;
};

export type MissionMcpSignalAcknowledgement = AgentSessionSignalAcknowledgement;

type MissionMcpSignalToolDefinition<Input> = {
	name: MissionMcpSignalToolName;
	description: string;
	inputSchema: z.ZodType<Input>;
	toSignal(input: Input): AgentSessionSignal;
};

type AnyMissionMcpSignalToolDefinition = MissionMcpSignalToolDefinition<any>;

export type MissionMcpValidatedToolCall = {
	name: MissionMcpSignalToolName;
	envelope: MissionMcpSignalEnvelope;
	signal: AgentSessionSignal;
};

const boundedSignalTextSchema = z.string().trim().min(1).max(MAX_AGENT_SESSION_SIGNAL_TEXT_LENGTH);
const boundedMessageTextSchema = z.string().trim().min(1).max(MAX_AGENT_SESSION_MESSAGE_LENGTH);
const suggestedResponsesSchema = z
	.array(boundedSignalTextSchema)
	.min(1)
	.max(MAX_AGENT_SESSION_SUGGESTED_RESPONSES)
	.optional();
const metadataValueSchema = z.union([
	z.string(),
	z.number().finite(),
	z.boolean(),
	z.null()
]);

export const missionMcpSignalEnvelopeSchema = z.object({
	missionId: z.string().trim().min(1).max(128),
	taskId: z.string().trim().min(1).max(128),
	agentSessionId: z.string().trim().min(1).max(128),
	eventId: z.string().trim().min(1).max(256)
}).strict();

const usagePayloadSchema = z.record(z.string(), metadataValueSchema).superRefine((payload, context) => {
	const entries = Object.entries(payload);
	if (entries.length > MAX_AGENT_SESSION_USAGE_ENTRIES) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: `usage payload exceeded the maximum supported size of ${MAX_AGENT_SESSION_USAGE_ENTRIES} entries.`
		});
	}
	for (const [key, value] of entries) {
		if (!key.trim()) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: [key],
				message: 'usage payload keys must not be empty.'
			});
		}
		if (!isScalarAgentMetadataValue(value)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: [key],
				message: `usage payload entry '${key}' must be a scalar metadata value.`
			});
		}
	}
});

const missionReportProgressSchema = missionMcpSignalEnvelopeSchema.extend({
	summary: boundedSignalTextSchema,
	detail: boundedSignalTextSchema.optional()
}).strict();

const missionRequestOperatorInputSchema = missionMcpSignalEnvelopeSchema.extend({
	question: boundedSignalTextSchema,
	suggestedResponses: suggestedResponsesSchema
}).strict();

const missionReportBlockedSchema = missionMcpSignalEnvelopeSchema.extend({
	reason: boundedSignalTextSchema
}).strict();

const missionReportReadyForVerificationSchema = missionMcpSignalEnvelopeSchema.extend({
	summary: boundedSignalTextSchema
}).strict();

const missionReportCompletionClaimSchema = missionMcpSignalEnvelopeSchema.extend({
	summary: boundedSignalTextSchema
}).strict();

const missionReportFailureClaimSchema = missionMcpSignalEnvelopeSchema.extend({
	reason: boundedSignalTextSchema
}).strict();

const missionAppendSessionNoteSchema = missionMcpSignalEnvelopeSchema.extend({
	text: boundedMessageTextSchema
}).strict();

const missionReportUsageSchema = missionMcpSignalEnvelopeSchema.extend({
	payload: usagePayloadSchema
}).strict();

const missionMcpSignalToolDefinitions = {
	mission_report_progress: {
		name: 'mission_report_progress',
		description: 'Report structured Mission session progress through the daemon-owned signal policy.',
		inputSchema: missionReportProgressSchema,
		toSignal(input) {
			return {
				type: 'progress',
				summary: input.summary,
				...(input.detail ? { detail: input.detail } : {}),
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_request_operator_input: {
		name: 'mission_request_operator_input',
		description: 'Ask Mission to surface an operator decision for the active agent session.',
		inputSchema: missionRequestOperatorInputSchema,
		toSignal(input) {
			return {
				type: 'needs_input',
				question: input.question,
				...(input.suggestedResponses ? { suggestedResponses: [...input.suggestedResponses] } : {}),
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_report_blocked: {
		name: 'mission_report_blocked',
		description: 'Report that the active agent session is blocked and waiting on Mission/system help.',
		inputSchema: missionReportBlockedSchema,
		toSignal(input) {
			return {
				type: 'blocked',
				reason: input.reason,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_report_ready_for_verification: {
		name: 'mission_report_ready_for_verification',
		description: 'Report a ready-for-verification claim without taking workflow authority.',
		inputSchema: missionReportReadyForVerificationSchema,
		toSignal(input) {
			return {
				type: 'ready_for_verification',
				summary: input.summary,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_report_completion_claim: {
		name: 'mission_report_completion_claim',
		description: 'Report a completion claim as structured MCP data without mutating workflow state directly.',
		inputSchema: missionReportCompletionClaimSchema,
		toSignal(input) {
			return {
				type: 'completed_claim',
				summary: input.summary,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_report_failure_claim: {
		name: 'mission_report_failure_claim',
		description: 'Report a failure claim as structured MCP data without mutating workflow state directly.',
		inputSchema: missionReportFailureClaimSchema,
		toSignal(input) {
			return {
				type: 'failed_claim',
				reason: input.reason,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_append_session_note: {
		name: 'mission_append_session_note',
		description: 'Append an agent-authored session note/message without taking workflow authority.',
		inputSchema: missionAppendSessionNoteSchema,
		toSignal(input) {
			return {
				type: 'message',
				channel: 'agent',
				text: input.text,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	mission_report_usage: {
		name: 'mission_report_usage',
		description: 'Attach structured usage metadata to the active Mission session.',
		inputSchema: missionReportUsageSchema,
		toSignal(input) {
			return {
				type: 'usage',
				payload: { ...input.payload },
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	}
} as const satisfies Record<MissionMcpSignalToolName, AnyMissionMcpSignalToolDefinition>;

export function getMissionMcpSignalToolDefinition(
	name: MissionMcpSignalToolName
): AnyMissionMcpSignalToolDefinition {
	return missionMcpSignalToolDefinitions[name];
}

export function listMissionMcpSignalToolDefinitions(): AnyMissionMcpSignalToolDefinition[] {
	return missionMcpSignalToolNames.map((toolName) => missionMcpSignalToolDefinitions[toolName]);
}

export function parseMissionMcpSignalToolCall(
	name: MissionMcpSignalToolName,
	input: unknown
): { success: true; value: MissionMcpValidatedToolCall } | { success: false; reason: string } {
	const definition = missionMcpSignalToolDefinitions[name];
	const parsed = definition.inputSchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			reason: `Invalid payload for MCP tool '${name}': ${formatZodIssues(parsed.error.issues)}`
		};
	}

	return {
		success: true,
		value: {
			name,
			envelope: toEnvelope(parsed.data),
			signal: definition.toSignal(parsed.data)
		}
	};
}

function toEnvelope(input: MissionMcpSignalEnvelope): MissionMcpSignalEnvelope {
	return {
		missionId: input.missionId,
		taskId: input.taskId,
		agentSessionId: input.agentSessionId,
		eventId: input.eventId
	};
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
