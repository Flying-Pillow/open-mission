import type { AgentId } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type {
	MissionMcpAllowedEntityCommand
} from './MissionMcpEntityCommandTools.js';
import type {
	MissionMcpRegisteredSession,
	MissionMcpSignalServer
} from './MissionMcpSignalServer.js';
import { MissionMcpAgentBridge } from './MissionMcpAgentBridge.js';
import type { MissionMcpToolName } from './MissionMcpSessionRegistry.js';

export type AgentExecutionMcpAccessState =
	| 'mcp-validated'
	| 'mcp-degraded'
	| 'mcp-unavailable';

export type AgentExecutionMcpProvisioningPolicy =
	| 'required'
	| 'optional'
	| 'disabled';

export type AgentExecutionMcpRegistration = {
	missionId: string;
	taskId: string;
	agentExecutionId: string;
	sessionToken: string;
	allowedTools: MissionMcpToolName[];
	allowedEntityCommands?: MissionMcpAllowedEntityCommand[];
	endpoint: string;
};

export type AgentExecutionMcpProvisioningResult = {
	agentId: AgentId;
	policy: AgentExecutionMcpProvisioningPolicy;
	accessState: AgentExecutionMcpAccessState;
	launchEnv: Record<string, string>;
	generatedFiles: string[];
	reason?: string;
	cleanup(): Promise<void>;
};

type MissionMcpSignalRegistrar = Pick<MissionMcpSignalServer, 'registerExecution' | 'unregisterExecution'>;

export class AgentExecutionMcpProvisioningError extends Error {
	public readonly agentId: AgentId;

	public constructor(agentId: AgentId, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'AgentExecutionMcpProvisioningError';
		this.agentId = agentId;
	}
}

export class AgentExecutionMcpAccessProvisioner {
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
		agentId: AgentId;
		policy: AgentExecutionMcpProvisioningPolicy;
		workingDirectory: string;
		missionId: string;
		taskId: string;
		agentExecutionId: string;
		allowedTools: MissionMcpToolName[];
		allowedEntityCommands?: MissionMcpAllowedEntityCommand[];
	}): Promise<AgentExecutionMcpProvisioningResult> {
		if (input.policy === 'disabled') {
			return {
				agentId: input.agentId,
				policy: input.policy,
				accessState: 'mcp-unavailable',
				launchEnv: {},
				generatedFiles: [],
				reason: 'MCP provisioning is disabled for this execution.',
				cleanup: async () => undefined
			};
		}

		let registeredSession: MissionMcpRegisteredSession | undefined;
		try {
			registeredSession = await this.signalServer.registerExecution({
				missionId: input.missionId,
				taskId: input.taskId,
				agentExecutionId: input.agentExecutionId,
				allowedTools: [...input.allowedTools],
				...(input.allowedEntityCommands ? {
					allowedEntityCommands: input.allowedEntityCommands.map((command) => ({ ...command }))
				} : {})
			});

			const registration = this.createRegistration(registeredSession);
			return {
				agentId: input.agentId,
				policy: input.policy,
				accessState: 'mcp-validated',
				launchEnv: this.bridge.createLaunchEnv({
					endpoint: registration.endpoint,
					sessionToken: registration.sessionToken
				}),
				generatedFiles: [],
				cleanup: createSingleUseCleanup(async () => {
					await this.signalServer.unregisterExecution(registration.sessionToken);
				})
			};
		} catch (error) {
			if (error instanceof AgentExecutionMcpProvisioningError) {
				throw error;
			}
			if (registeredSession) {
				await this.signalServer.unregisterExecution(registeredSession.sessionToken);
			}
			return this.handleProvisioningFallback(
				input,
				'mcp-degraded',
				formatProvisioningError(error),
				error
			);
		}
	}

	private createRegistration(registeredSession: MissionMcpRegisteredSession): AgentExecutionMcpRegistration {
		return {
			missionId: registeredSession.missionId,
			taskId: registeredSession.taskId,
			agentExecutionId: registeredSession.agentExecutionId,
			sessionToken: registeredSession.sessionToken,
			allowedTools: [...registeredSession.allowedTools],
			...(registeredSession.allowedEntityCommands ? {
				allowedEntityCommands: registeredSession.allowedEntityCommands.map((command) => ({ ...command }))
			} : {}),
			endpoint: registeredSession.endpoint
		};
	}

	private async handleProvisioningFallback(
		input: {
			agentId: AgentId;
			policy: AgentExecutionMcpProvisioningPolicy;
		},
		accessState: AgentExecutionMcpAccessState,
		reason: string,
		cause?: unknown
	): Promise<AgentExecutionMcpProvisioningResult> {
		if (input.policy === 'required') {
			throw new AgentExecutionMcpProvisioningError(
				input.agentId,
				reason,
				cause !== undefined ? { cause } : undefined
			);
		}
		return {
			agentId: input.agentId,
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
