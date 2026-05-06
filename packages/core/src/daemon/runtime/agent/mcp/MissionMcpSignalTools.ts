import { z } from 'zod/v4';
import type { AgentExecutionSignalAcknowledgement } from '../signals/AgentExecutionSignalPort.js';
import {
	MAX_AGENT_EXECUTION_MESSAGE_LENGTH,
	MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
	MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES,
	MAX_AGENT_EXECUTION_USAGE_ENTRIES,
	isScalarAgentMetadataValue,
	type AgentExecutionSignal
} from '../signals/AgentExecutionSignal.js';

export const missionMcpSignalToolNames = [
	'progress',
	'request_input',
	'blocked',
	'ready',
	'complete',
	'fail',
	'note',
	'usage'
] as const;

export type MissionMcpSignalToolName = (typeof missionMcpSignalToolNames)[number];

export const missionMcpSignalToolNameSchema = z.enum(missionMcpSignalToolNames);

export type MissionMcpSignalAcknowledgement = AgentExecutionSignalAcknowledgement;

type MissionMcpSignalToolDefinition<Input> = {
	name: MissionMcpSignalToolName;
	description: string;
	inputSchema: z.ZodType<Input>;
	toSignal(input: Input): AgentExecutionSignal;
};

type AnyMissionMcpSignalToolDefinition = MissionMcpSignalToolDefinition<any>;

export type MissionMcpValidatedToolCall = {
	name: MissionMcpSignalToolName;
	signal: AgentExecutionSignal;
};

const boundedSignalTextSchema = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH);
const boundedMessageTextSchema = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_MESSAGE_LENGTH);
const suggestedResponsesSchema = z
	.array(boundedSignalTextSchema)
	.min(1)
	.max(MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES)
	.optional();
const metadataValueSchema = z.union([
	z.string(),
	z.number().finite(),
	z.boolean(),
	z.null()
]);

const usagePayloadSchema = z.record(z.string(), metadataValueSchema).superRefine((payload, context) => {
	const entries = Object.entries(payload);
	if (entries.length > MAX_AGENT_EXECUTION_USAGE_ENTRIES) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: `usage payload exceeded the maximum supported size of ${String(MAX_AGENT_EXECUTION_USAGE_ENTRIES)} entries.`
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

const missionProgressSchema = z.object({
	summary: boundedSignalTextSchema,
	detail: boundedSignalTextSchema.optional()
}).strict();

const missionRequestInputSchema = z.object({
	question: boundedSignalTextSchema,
	suggestedResponses: suggestedResponsesSchema
}).strict();

const missionBlockedSchema = z.object({
	reason: boundedSignalTextSchema
}).strict();

const missionReadySchema = z.object({
	summary: boundedSignalTextSchema
}).strict();

const missionCompleteSchema = z.object({
	summary: boundedSignalTextSchema
}).strict();

const missionFailSchema = z.object({
	reason: boundedSignalTextSchema
}).strict();

const missionNoteSchema = z.object({
	text: boundedMessageTextSchema
}).strict();

const missionUsageSchema = z.object({
	payload: usagePayloadSchema
}).strict();

const missionMcpSignalToolDefinitions = {
	progress: {
		name: 'progress',
		description: 'Report structured progress.',
		inputSchema: missionProgressSchema,
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
	request_input: {
		name: 'request_input',
		description: 'Ask for an operator decision.',
		inputSchema: missionRequestInputSchema,
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
	blocked: {
		name: 'blocked',
		description: 'Report that the session is blocked.',
		inputSchema: missionBlockedSchema,
		toSignal(input) {
			return {
				type: 'blocked',
				reason: input.reason,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	ready: {
		name: 'ready',
		description: 'Report ready-for-verification.',
		inputSchema: missionReadySchema,
		toSignal(input) {
			return {
				type: 'ready_for_verification',
				summary: input.summary,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	complete: {
		name: 'complete',
		description: 'Report a completion claim.',
		inputSchema: missionCompleteSchema,
		toSignal(input) {
			return {
				type: 'completed_claim',
				summary: input.summary,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	fail: {
		name: 'fail',
		description: 'Report a failure claim.',
		inputSchema: missionFailSchema,
		toSignal(input) {
			return {
				type: 'failed_claim',
				reason: input.reason,
				source: 'mcp-validated',
				confidence: 'high'
			};
		}
	},
	note: {
		name: 'note',
		description: 'Append a short session note.',
		inputSchema: missionNoteSchema,
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
	usage: {
		name: 'usage',
		description: 'Attach structured usage metadata.',
		inputSchema: missionUsageSchema,
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
			signal: definition.toSignal(parsed.data)
		}
	};
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
