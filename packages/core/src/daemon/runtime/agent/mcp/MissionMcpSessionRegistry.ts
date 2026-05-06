import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import type {
	MissionMcpSignalToolName
} from './MissionMcpSignalTools.js';
import {
	missionMcpSignalToolNameSchema
} from './MissionMcpSignalTools.js';
import {
	missionMcpAllowedEntityCommandSchema,
	missionMcpEntityCommandToolName,
	type MissionMcpAllowedEntityCommand,
	type MissionMcpEntityCommandToolName
} from './MissionMcpEntityCommandTools.js';

export type MissionMcpToolName = MissionMcpSignalToolName | MissionMcpEntityCommandToolName;

export type MissionMcpSessionRegistration = {
	missionId: string;
	taskId: string;
	agentSessionId: string;
	sessionToken: string;
	allowedTools: MissionMcpToolName[];
	allowedEntityCommands?: MissionMcpAllowedEntityCommand[];
};

type MissionMcpSessionRegistrationInput = Omit<MissionMcpSessionRegistration, 'sessionToken'>;

type MissionMcpSessionRegistryEntry = {
	registration: MissionMcpSessionRegistration;
};

const missionMcpSessionRegistrationSchema = z.object({
	missionId: z.string().trim().min(1),
	taskId: z.string().trim().min(1),
	agentSessionId: z.string().trim().min(1),
	allowedTools: z.array(z.union([
		missionMcpSignalToolNameSchema,
		z.literal(missionMcpEntityCommandToolName)
	])),
	allowedEntityCommands: z.array(missionMcpAllowedEntityCommandSchema).optional()
}).strict();

export class MissionMcpSessionRegistry {
	private readonly registrationsByToken = new Map<string, MissionMcpSessionRegistryEntry>();

	private readonly tokenByAgentSessionId = new Map<string, string>();

	public registerSession(input: MissionMcpSessionRegistrationInput): MissionMcpSessionRegistration {
		const registration = parseRegistration(input);
		const sessionToken = randomUUID();
		const stored = {
			...registration,
			sessionToken
		};
		const existingToken = this.tokenByAgentSessionId.get(stored.agentSessionId);
		if (existingToken) {
			this.registrationsByToken.delete(existingToken);
		}
		this.tokenByAgentSessionId.set(stored.agentSessionId, sessionToken);
		this.registrationsByToken.set(sessionToken, {
			registration: stored
		});
		return cloneRegistration(stored);
	}

	public unregisterSession(sessionToken: string): void {
		const token = sessionToken.trim();
		const entry = this.registrationsByToken.get(token);
		if (!entry) {
			return;
		}
		this.registrationsByToken.delete(token);
		if (this.tokenByAgentSessionId.get(entry.registration.agentSessionId) === token) {
			this.tokenByAgentSessionId.delete(entry.registration.agentSessionId);
		}
	}

	public clear(): void {
		this.registrationsByToken.clear();
		this.tokenByAgentSessionId.clear();
	}

	public getRegisteredSessionCount(): number {
		return this.registrationsByToken.size;
	}

	public getAllowedTools(sessionToken: string): MissionMcpToolName[] | undefined {
		return this.registrationsByToken.get(sessionToken.trim())?.registration.allowedTools;
	}

	public authorizeTool(input: {
		sessionToken: string;
		toolName: MissionMcpToolName;
	}): { ok: true; registration: MissionMcpSessionRegistration } | { ok: false; reason: string } {
		const entry = this.getEntry(input.sessionToken);
		if (!entry) {
			return {
				ok: false,
				reason: 'Unknown Mission MCP session token.'
			};
		}
		if (!entry.registration.allowedTools.includes(input.toolName)) {
			return {
				ok: false,
				reason: `Mission MCP tool '${input.toolName}' is not allowed for this session.`
			};
		}
		return {
			ok: true,
			registration: cloneRegistration(entry.registration)
		};
	}

	public authorizeEntityCommand(input: {
		sessionToken: string;
		toolName: MissionMcpEntityCommandToolName;
		entity: string;
		method: string;
		commandId?: string;
	}): { ok: true; registration: MissionMcpSessionRegistration } | { ok: false; reason: string } {
		const toolAuthorization = this.authorizeTool(input);
		if (!toolAuthorization.ok) {
			return toolAuthorization;
		}
		if (!toolAuthorization.registration.allowedEntityCommands?.some((allowedCommand) =>
			matchesAllowedEntityCommand(allowedCommand, input)
		)) {
			return {
				ok: false,
				reason: `Entity command '${input.entity}.${input.method}${input.commandId ? `:${input.commandId}` : ''}' is not allowed for this session.`
			};
		}
		return toolAuthorization;
	}

	private getEntry(sessionToken: string): MissionMcpSessionRegistryEntry | undefined {
		return this.registrationsByToken.get(sessionToken.trim());
	}
}

function parseRegistration(input: MissionMcpSessionRegistrationInput): MissionMcpSessionRegistrationInput {
	const parsed = missionMcpSessionRegistrationSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(`Invalid Mission MCP session registration: ${formatZodIssues(parsed.error.issues)}`);
	}

	return {
		missionId: parsed.data.missionId,
		taskId: parsed.data.taskId,
		agentSessionId: parsed.data.agentSessionId,
		allowedTools: [...new Set(parsed.data.allowedTools)],
		...(parsed.data.allowedEntityCommands ? {
			allowedEntityCommands: dedupeAllowedEntityCommands(parsed.data.allowedEntityCommands)
		} : {})
	};
}

function cloneRegistration(input: MissionMcpSessionRegistration): MissionMcpSessionRegistration {
	return {
		missionId: input.missionId,
		taskId: input.taskId,
		agentSessionId: input.agentSessionId,
		sessionToken: input.sessionToken,
		allowedTools: [...input.allowedTools],
		...(input.allowedEntityCommands ? {
			allowedEntityCommands: input.allowedEntityCommands.map((command) => ({ ...command }))
		} : {})
	};
}

function matchesAllowedEntityCommand(
	allowedCommand: MissionMcpAllowedEntityCommand,
	input: { entity: string; method: string; commandId?: string }
): boolean {
	return allowedCommand.entity === input.entity
		&& allowedCommand.method === input.method
		&& (!allowedCommand.commandId || allowedCommand.commandId === input.commandId);
}

function dedupeAllowedEntityCommands(
	commands: MissionMcpAllowedEntityCommand[]
): MissionMcpAllowedEntityCommand[] {
	const seen = new Set<string>();
	const deduped: MissionMcpAllowedEntityCommand[] = [];
	for (const command of commands) {
		const key = `${command.entity}\u0000${command.method}\u0000${command.commandId ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push({ ...command });
	}
	return deduped;
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
