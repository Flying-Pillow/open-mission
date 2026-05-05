import { randomUUID } from 'node:crypto';
import type { AgentSessionSignalPort } from '../signals/AgentSessionSignalPort.js';
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

export type MissionMcpSignalServerHandle = {
	serverId: string;
	endpoint: string;
	localOnly: true;
	transport: 'in-memory-local';
	toolNames: readonly MissionMcpSignalToolName[];
	healthCheck(): Promise<MissionMcpSignalServerHealth>;
	invokeTool(name: MissionMcpSignalToolName, payload: unknown): Promise<MissionMcpSignalAcknowledgement>;
};

export type MissionMcpSignalServerHealth = {
	serverId: string;
	endpoint: string;
	running: boolean;
	localOnly: true;
	transport: 'in-memory-local';
	registeredSessionCount: number;
};

export type MissionMcpRegisteredSession = MissionMcpSessionRegistration & {
	endpoint: string;
	localOnly: true;
	transport: 'in-memory-local';
};

export class MissionMcpSignalServer {
	private readonly signalPort: AgentSessionSignalPort;

	private readonly sessionRegistry: MissionMcpSessionRegistry;

	private handle: MissionMcpSignalServerHandle | undefined;

	public constructor(options: {
		signalPort: AgentSessionSignalPort;
		sessionRegistry?: MissionMcpSessionRegistry;
	}) {
		this.signalPort = options.signalPort;
		this.sessionRegistry = options.sessionRegistry ?? new MissionMcpSessionRegistry();
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
			toolNames: missionMcpSignalToolNames,
			healthCheck: async () => this.healthCheck(),
			invokeTool: async (name, payload) => this.invokeTool(name, payload)
		};
		return this.handle;
	}

	public async registerSession(
		input: MissionMcpSessionRegistration
	): Promise<MissionMcpRegisteredSession> {
		const handle = this.requireHandle();
		const registration = this.sessionRegistry.registerSession(input);
		return {
			...registration,
			endpoint: handle.endpoint,
			localOnly: true,
			transport: 'in-memory-local'
		};
	}

	public async unregisterSession(agentSessionId: string): Promise<void> {
		this.sessionRegistry.unregisterSession(agentSessionId);
	}

	public async stop(): Promise<void> {
		this.sessionRegistry.clear();
		this.handle = undefined;
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

	private async invokeTool(
		name: MissionMcpSignalToolName,
		payload: unknown
	): Promise<MissionMcpSignalAcknowledgement> {
		if (!this.handle) {
			return rejectAcknowledgement('Mission MCP signal server is not running.');
		}
		if (!listMissionMcpSignalToolDefinitions().some((definition) => definition.name === name)) {
			return rejectAcknowledgement(`Unknown Mission MCP tool '${name}'.`);
		}

		const parsed = parseMissionMcpSignalToolCall(name, payload);
		if (!parsed.success) {
			return rejectAcknowledgement(parsed.reason);
		}

		const authorization = this.sessionRegistry.authorizeTool({
			envelope: parsed.value.envelope,
			toolName: name
		});
		if (!authorization.ok) {
			return rejectAcknowledgement(authorization.reason);
		}

		const acknowledgement = await this.signalPort.reportSignal({
			scope: {
				missionId: parsed.value.envelope.missionId,
				taskId: parsed.value.envelope.taskId,
				agentSessionId: parsed.value.envelope.agentSessionId
			},
			eventId: parsed.value.envelope.eventId,
			signal: parsed.value.signal
		});
		if (acknowledgement.accepted) {
			this.sessionRegistry.rememberEvent(
				parsed.value.envelope.agentSessionId,
				parsed.value.envelope.eventId
			);
		}
		return acknowledgement;
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
