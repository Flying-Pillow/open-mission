import { z } from 'zod/v4';

export const MISSION_MCP_SERVER_NAME = 'mission';
export const MISSION_MCP_AGENT_BRIDGE_COMMAND = 'mission-command';
export const MISSION_MCP_AGENT_BRIDGE_ARGS = [] as const;

export type MissionMcpAgentBridgeLaunchSpec = {
	command: string;
	args: string[];
};

export const missionMcpAgentBridgeEnvKeys = {
	endpoint: 'MISSION_MCP_ENDPOINT',
	sessionToken: 'MISSION_MCP_SESSION_TOKEN'
} as const;

export type MissionMcpAgentBridgeLaunchContext = {
	endpoint: string;
	sessionToken: string;
};

type MissionMcpAgentBridgeLaunchContextInput = MissionMcpAgentBridgeLaunchContext;

const missionMcpAgentBridgeLaunchContextSchema = z.object({
	endpoint: z.string().trim().min(1),
	sessionToken: z.string().trim().min(1)
}).strict();

export class MissionMcpAgentBridge {
	public readonly serverName = MISSION_MCP_SERVER_NAME;

	public readonly command: string;

	public readonly args: string[];

	public constructor(launchSpec: MissionMcpAgentBridgeLaunchSpec = {
		command: MISSION_MCP_AGENT_BRIDGE_COMMAND,
		args: [...MISSION_MCP_AGENT_BRIDGE_ARGS]
	}) {
		this.command = launchSpec.command;
		this.args = [...launchSpec.args];
	}

	public createLaunchEnv(input: MissionMcpAgentBridgeLaunchContext): Record<string, string> {
		const context = parseLaunchContext(input);
		return {
			[missionMcpAgentBridgeEnvKeys.endpoint]: context.endpoint,
			[missionMcpAgentBridgeEnvKeys.sessionToken]: context.sessionToken
		};
	}

	public readLaunchEnv(env: NodeJS.ProcessEnv): MissionMcpAgentBridgeLaunchContext {
		return parseLaunchContext({
			endpoint: env[missionMcpAgentBridgeEnvKeys.endpoint] ?? '',
			sessionToken: env[missionMcpAgentBridgeEnvKeys.sessionToken] ?? ''
		});
	}
}

function parseLaunchContext(
	input: MissionMcpAgentBridgeLaunchContextInput
): MissionMcpAgentBridgeLaunchContext {
	const parsed = missionMcpAgentBridgeLaunchContextSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(`Invalid Mission MCP agent bridge context: ${formatIssues(parsed.error.issues)}`);
	}

	return {
		endpoint: parsed.data.endpoint,
		sessionToken: parsed.data.sessionToken
	};
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
