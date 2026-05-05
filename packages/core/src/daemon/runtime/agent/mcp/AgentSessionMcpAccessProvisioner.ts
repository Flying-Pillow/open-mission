import type { AgentRunnerId } from '../AgentRuntimeTypes.js';
import type { MissionMcpSignalToolName } from './MissionMcpSignalTools.js';
import type {
	MissionMcpRegisteredSession,
	MissionMcpSignalServer
} from './MissionMcpSignalServer.js';
import { MissionMcpAgentBridge } from './MissionMcpAgentBridge.js';

export type AgentSessionMcpAccessState =
	| 'mcp-validated'
	| 'mcp-degraded'
	| 'mcp-unavailable';

export type AgentSessionMcpProvisioningPolicy =
	| 'required'
	| 'optional'
	| 'disabled';

export type AgentSessionMcpRegistration = {
	missionId: string;
	taskId: string;
	agentSessionId: string;
	allowedTools: MissionMcpSignalToolName[];
	endpoint: string;
};

export type AgentSessionMcpProvisioningResult = {
	runnerId: AgentRunnerId;
	policy: AgentSessionMcpProvisioningPolicy;
	accessState: AgentSessionMcpAccessState;
	launchEnv: Record<string, string>;
	generatedFiles: string[];
	reason?: string;
	cleanup(): Promise<void>;
};

type MissionMcpSignalRegistrar = Pick<MissionMcpSignalServer, 'registerSession' | 'unregisterSession'>;

export class AgentSessionMcpProvisioningError extends Error {
	public readonly runnerId: AgentRunnerId;

	public constructor(runnerId: AgentRunnerId, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'AgentSessionMcpProvisioningError';
		this.runnerId = runnerId;
	}
}

export class AgentSessionMcpAccessProvisioner {
	private readonly signalServer: MissionMcpSignalRegistrar;

	private readonly bridge: MissionMcpAgentBridge;

	public constructor(options: {
		signalServer: MissionMcpSignalRegistrar;
		bridge?: MissionMcpAgentBridge;
	}) {
		this.signalServer = options.signalServer;
		this.bridge = options.bridge ?? new MissionMcpAgentBridge();
	}

	public async provision(input: {
		runnerId: AgentRunnerId;
		policy: AgentSessionMcpProvisioningPolicy;
		workingDirectory: string;
		missionId: string;
		taskId: string;
		agentSessionId: string;
		allowedTools: MissionMcpSignalToolName[];
	}): Promise<AgentSessionMcpProvisioningResult> {
		if (input.policy === 'disabled') {
			return {
				runnerId: input.runnerId,
				policy: input.policy,
				accessState: 'mcp-unavailable',
				launchEnv: {},
				generatedFiles: [],
				reason: 'MCP provisioning is disabled for this session.',
				cleanup: async () => undefined
			};
		}

		let registeredSession: MissionMcpRegisteredSession | undefined;
		try {
			registeredSession = await this.signalServer.registerSession({
				missionId: input.missionId,
				taskId: input.taskId,
				agentSessionId: input.agentSessionId,
				allowedTools: [...input.allowedTools]
			});

			const registration = this.createRegistration(registeredSession);
			return {
				runnerId: input.runnerId,
				policy: input.policy,
				accessState: 'mcp-validated',
				launchEnv: this.bridge.createLaunchEnv(registration),
				generatedFiles: [],
				cleanup: createSingleUseCleanup(async () => {
					await this.signalServer.unregisterSession(input.agentSessionId);
				})
			};
		} catch (error) {
			if (error instanceof AgentSessionMcpProvisioningError) {
				throw error;
			}
			if (registeredSession) {
				await this.signalServer.unregisterSession(input.agentSessionId);
			}
			return this.handleProvisioningFallback(
				input,
				'mcp-degraded',
				formatProvisioningError(error),
				error
			);
		}
	}

	private createRegistration(registeredSession: MissionMcpRegisteredSession): AgentSessionMcpRegistration {
		return {
			missionId: registeredSession.missionId,
			taskId: registeredSession.taskId,
			agentSessionId: registeredSession.agentSessionId,
			allowedTools: [...registeredSession.allowedTools],
			endpoint: registeredSession.endpoint
		};
	}

	private async handleProvisioningFallback(
		input: {
			runnerId: AgentRunnerId;
			policy: AgentSessionMcpProvisioningPolicy;
		},
		accessState: AgentSessionMcpAccessState,
		reason: string,
		cause?: unknown
	): Promise<AgentSessionMcpProvisioningResult> {
		if (input.policy === 'required') {
			throw new AgentSessionMcpProvisioningError(
				input.runnerId,
				reason,
				cause !== undefined ? { cause } : undefined
			);
		}
		return {
			runnerId: input.runnerId,
			policy: input.policy,
			accessState,
			launchEnv: {},
			generatedFiles: [],
			reason,
			cleanup: async () => undefined
		};
	}
}

function createSingleUseCleanup(cleanup: () => Promise<void>): () => Promise<void> {
	let executed = false;
	return async () => {
		if (executed) {
			return;
		}
		executed = true;
		await cleanup();
	};
}

function formatProvisioningError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
