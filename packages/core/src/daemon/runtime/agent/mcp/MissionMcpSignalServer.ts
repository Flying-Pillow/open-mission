import { randomUUID } from 'node:crypto';
import type { AgentExecutionSignalPort } from '../signals/AgentExecutionSignalPort.js';
import {
	listMissionMcpSignalToolDefinitions,
	missionMcpSignalToolNames,
	parseMissionMcpSignalToolCall,
	type MissionMcpSignalAcknowledgement,
	type MissionMcpSignalToolName
} from './MissionMcpSignalTools.js';
import {
	MissionMcpSessionRegistry,
	type MissionMcpSessionRegistration
} from './MissionMcpSessionRegistry.js';
import {
	missionMcpEntityCommandToolName,
	parseMissionMcpEntityCommandToolCall,
	type MissionMcpEntityCommandAcknowledgement,
	type MissionMcpEntityCommandExecutor,
	type MissionMcpEntityCommandToolName
} from './MissionMcpEntityCommandTools.js';

export type MissionMcpSignalServerHandle = {
	serverId: string;
	endpoint: string;
	localOnly: true;
	transport: 'in-memory-local';
	toolNames: readonly MissionMcpToolName[];
	listTools(sessionToken?: string): Promise<string[]>;
	healthCheck(): Promise<MissionMcpSignalServerHealth>;
	invokeTool(name: MissionMcpToolName, payload: unknown, sessionToken?: string): Promise<MissionMcpToolAcknowledgement>;
};

export type MissionMcpSignalServerHealth = {
	serverId: string;
	endpoint: string;
	running: boolean;
	localOnly: true;
	transport: 'in-memory-local';
	registeredSessionCount: number;
};

export type MissionMcpToolName = MissionMcpSignalToolName | MissionMcpEntityCommandToolName;

export type MissionMcpToolAcknowledgement =
	| MissionMcpSignalAcknowledgement
	| MissionMcpEntityCommandAcknowledgement;

export type MissionMcpRegisteredSession = MissionMcpSessionRegistration & {
	endpoint: string;
	localOnly: true;
	transport: 'in-memory-local';
};

export class MissionMcpSignalServer {
	private readonly signalPort: AgentExecutionSignalPort;

	private readonly sessionRegistry: MissionMcpSessionRegistry;

	private readonly executeEntityCommand: MissionMcpEntityCommandExecutor | undefined;

	private handle: MissionMcpSignalServerHandle | undefined;

	public constructor(options: {
		signalPort: AgentExecutionSignalPort;
		sessionRegistry?: MissionMcpSessionRegistry;
		executeEntityCommand?: MissionMcpEntityCommandExecutor;
	}) {
		this.signalPort = options.signalPort;
		this.sessionRegistry = options.sessionRegistry ?? new MissionMcpSessionRegistry();
		this.executeEntityCommand = options.executeEntityCommand;
	}

	public async start(): Promise<MissionMcpSignalServerHandle> {
		if (this.handle) {
			return this.handle;
		}

		const serverId = randomUUID();
		this.handle = {
			serverId,
			endpoint: `mission-local://mcp-signal/${serverId}`,
			localOnly: true,
			transport: 'in-memory-local',
			toolNames: [...missionMcpSignalToolNames, missionMcpEntityCommandToolName],
			listTools: async (sessionToken) => this.listTools(sessionToken),
			healthCheck: async () => this.healthCheck(),
			invokeTool: async (name, payload, sessionToken) => this.invokeTool(name, payload, sessionToken)
		};
		return this.handle;
	}

	public async registerExecution(
		input: Omit<MissionMcpSessionRegistration, 'sessionToken'>
	): Promise<MissionMcpRegisteredSession> {
		const handle = this.requireHandle();
		const registration = this.sessionRegistry.registerExecution(input);
		return {
			...registration,
			endpoint: handle.endpoint,
			localOnly: true,
			transport: 'in-memory-local'
		};
	}

	public async unregisterExecution(sessionToken: string): Promise<void> {
		this.sessionRegistry.unregisterExecution(sessionToken);
	}

	public async stop(): Promise<void> {
		this.sessionRegistry.clear();
		this.handle = undefined;
	}

	public getStartedHandle(): MissionMcpSignalServerHandle {
		return this.requireHandle();
	}

	public async healthCheck(): Promise<MissionMcpSignalServerHealth> {
		const handle = this.requireHandle();
		return {
			serverId: handle.serverId,
			endpoint: handle.endpoint,
			running: true,
			localOnly: true,
			transport: 'in-memory-local',
			registeredSessionCount: this.sessionRegistry.getRegisteredSessionCount()
		};
	}

	private async listTools(sessionToken?: string): Promise<string[]> {
		if (!this.handle) {
			throw new Error('Mission MCP signal server is not running.');
		}
		const token = sessionToken?.trim();
		if (!token) {
			throw new Error('Mission MCP session token is required.');
		}
		const allowedTools = this.sessionRegistry.getAllowedTools(token);
		if (!allowedTools) {
			throw new Error('Unknown Mission MCP session token.');
		}
		return allowedTools;
	}

	private async invokeTool(
		name: MissionMcpToolName,
		payload: unknown,
		sessionToken?: string
	): Promise<MissionMcpToolAcknowledgement> {
		if (!this.handle) {
			return rejectAcknowledgement('Mission MCP signal server is not running.');
		}
		const token = sessionToken?.trim();
		if (!token) {
			return rejectAcknowledgement('Mission MCP session token is required.');
		}
		if (name === missionMcpEntityCommandToolName) {
			return this.invokeEntityCommandTool(payload, token);
		}
		if (!listMissionMcpSignalToolDefinitions().some((definition) => definition.name === name)) {
			return rejectAcknowledgement(`Unknown Mission MCP tool '${name}'.`);
		}

		const authorization = this.sessionRegistry.authorizeTool({
			sessionToken: token,
			toolName: name
		});
		if (!authorization.ok) {
			return rejectAcknowledgement(authorization.reason);
		}

		const parsed = parseMissionMcpSignalToolCall(name, payload);
		if (!parsed.success) {
			return rejectAcknowledgement(parsed.reason);
		}

		return this.signalPort.reportSignal({
			scope: {
				missionId: authorization.registration.missionId,
				taskId: authorization.registration.taskId,
				agentExecutionId: authorization.registration.agentExecutionId
			},
			eventId: createInvocationEventId(name),
			signal: parsed.value.signal
		});
	}

	private async invokeEntityCommandTool(
		payload: unknown,
		sessionToken: string
	): Promise<MissionMcpEntityCommandAcknowledgement> {
		const parsed = parseMissionMcpEntityCommandToolCall(payload);
		if (!parsed.success) {
			return rejectEntityCommandAcknowledgement(parsed.reason);
		}
		if (!this.executeEntityCommand) {
			return rejectEntityCommandAcknowledgement('Mission MCP entity command execution is not configured.');
		}

		const authorization = this.sessionRegistry.authorizeEntityCommand({
			sessionToken,
			toolName: missionMcpEntityCommandToolName,
			entity: parsed.value.invocation.entity,
			method: parsed.value.invocation.method,
			...(parsed.value.commandId ? { commandId: parsed.value.commandId } : {})
		});
		if (!authorization.ok) {
			return rejectEntityCommandAcknowledgement(authorization.reason);
		}

		try {
			const result = await this.executeEntityCommand(parsed.value.invocation);
			return {
				accepted: true,
				outcome: 'entity-command',
				result
			};
		} catch (error) {
			return rejectEntityCommandAcknowledgement(error instanceof Error ? error.message : String(error));
		}
	}

	private requireHandle(): MissionMcpSignalServerHandle {
		if (!this.handle) {
			throw new Error('Mission MCP signal server must be started before session registration.');
		}
		return this.handle;
	}
}

function rejectAcknowledgement(reason: string): MissionMcpSignalAcknowledgement {
	return {
		accepted: false,
		outcome: 'rejected',
		reason
	};
}

function rejectEntityCommandAcknowledgement(reason: string): MissionMcpEntityCommandAcknowledgement {
	return {
		accepted: false,
		outcome: 'rejected',
		reason
	};
}

function createInvocationEventId(toolName: string): string {
	return `${toolName}:${randomUUID()}`;
}
