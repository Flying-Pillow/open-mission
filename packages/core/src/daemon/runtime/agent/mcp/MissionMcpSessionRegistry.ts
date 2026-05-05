import { z } from 'zod/v4';
import type {
	MissionMcpSignalEnvelope,
	MissionMcpSignalToolName
} from './MissionMcpSignalTools.js';
import {
	missionMcpSignalEnvelopeSchema,
	missionMcpSignalToolNameSchema
} from './MissionMcpSignalTools.js';

export type MissionMcpSessionRegistration = {
	missionId: string;
	taskId: string;
	agentSessionId: string;
	allowedTools: MissionMcpSignalToolName[];
};

type MissionMcpSessionRegistryEntry = {
	registration: MissionMcpSessionRegistration;
	seenEventIds: Set<string>;
};

const missionMcpSessionRegistrationSchema = missionMcpSignalEnvelopeSchema.pick({
	missionId: true,
	taskId: true,
	agentSessionId: true
}).extend({
	allowedTools: z.array(missionMcpSignalToolNameSchema)
}).strict();

export class MissionMcpSessionRegistry {
	private readonly registrations = new Map<string, MissionMcpSessionRegistryEntry>();

	public registerSession(input: MissionMcpSessionRegistration): MissionMcpSessionRegistration {
		const registration = parseRegistration(input);
		this.registrations.set(registration.agentSessionId, {
			registration,
			seenEventIds: new Set<string>()
		});
		return cloneRegistration(registration);
	}

	public unregisterSession(agentSessionId: string): void {
		this.registrations.delete(agentSessionId);
	}

	public clear(): void {
		this.registrations.clear();
	}

	public getRegisteredSessionCount(): number {
		return this.registrations.size;
	}

	public authorizeTool(input: {
		envelope: MissionMcpSignalEnvelope;
		toolName: MissionMcpSignalToolName;
	}): { ok: true; registration: MissionMcpSessionRegistration } | { ok: false; reason: string } {
		const entry = this.registrations.get(input.envelope.agentSessionId);
		if (!entry) {
			return {
				ok: false,
				reason: `Unknown Mission MCP session '${input.envelope.agentSessionId}'.`
			};
		}
		if (entry.registration.missionId !== input.envelope.missionId) {
			return {
				ok: false,
				reason: `Mission MCP envelope mission '${input.envelope.missionId}' did not match registered mission '${entry.registration.missionId}'.`
			};
		}
		if (entry.registration.taskId !== input.envelope.taskId) {
			return {
				ok: false,
				reason: `Mission MCP envelope task '${input.envelope.taskId}' did not match registered task '${entry.registration.taskId}'.`
			};
		}
		if (!entry.registration.allowedTools.includes(input.toolName)) {
			return {
				ok: false,
				reason: `Mission MCP tool '${input.toolName}' is not allowed for session '${input.envelope.agentSessionId}'.`
			};
		}
		if (entry.seenEventIds.has(input.envelope.eventId)) {
			return {
				ok: false,
				reason: `Mission MCP event '${input.envelope.eventId}' was already processed for session '${input.envelope.agentSessionId}'.`
			};
		}
		return {
			ok: true,
			registration: cloneRegistration(entry.registration)
		};
	}

	public rememberEvent(agentSessionId: string, eventId: string): void {
		const entry = this.registrations.get(agentSessionId);
		if (!entry) {
			return;
		}
		entry.seenEventIds.add(eventId);
	}
}

function parseRegistration(input: MissionMcpSessionRegistration): MissionMcpSessionRegistration {
	const parsed = missionMcpSessionRegistrationSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(`Invalid Mission MCP session registration: ${formatZodIssues(parsed.error.issues)}`);
	}

	return {
		missionId: parsed.data.missionId,
		taskId: parsed.data.taskId,
		agentSessionId: parsed.data.agentSessionId,
		allowedTools: [...new Set(parsed.data.allowedTools)]
	};
}

function cloneRegistration(input: MissionMcpSessionRegistration): MissionMcpSessionRegistration {
	return {
		missionId: input.missionId,
		taskId: input.taskId,
		agentSessionId: input.agentSessionId,
		allowedTools: [...input.allowedTools]
	};
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
