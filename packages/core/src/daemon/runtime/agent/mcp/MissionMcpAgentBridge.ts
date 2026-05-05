import { z } from 'zod/v4';
import {
	missionMcpSignalToolNameSchema,
	type MissionMcpSignalToolName
} from './MissionMcpSignalTools.js';

export const MISSION_MCP_SERVER_NAME = 'mission_signal';
export const MISSION_MCP_AGENT_BRIDGE_COMMAND = 'mission';
export const MISSION_MCP_AGENT_BRIDGE_ARGS = ['mcp', 'agent-bridge'] as const;

export const missionMcpAgentBridgeEnvKeys = {
	endpoint: 'MISSION_MCP_ENDPOINT',
	missionId: 'MISSION_MCP_MISSION_ID',
	taskId: 'MISSION_MCP_TASK_ID',
	agentSessionId: 'MISSION_MCP_AGENT_SESSION_ID',
	allowedTools: 'MISSION_MCP_ALLOWED_TOOLS'
} as const;

export const missionMcpAgentBridgeEnvVarNames = Object.freeze([
	missionMcpAgentBridgeEnvKeys.endpoint,
	missionMcpAgentBridgeEnvKeys.missionId,
	missionMcpAgentBridgeEnvKeys.taskId,
	missionMcpAgentBridgeEnvKeys.agentSessionId,
	missionMcpAgentBridgeEnvKeys.allowedTools
]);

export type MissionMcpAgentBridgeLaunchContext = {
	endpoint: string;
	missionId: string;
	taskId: string;
	agentSessionId: string;
	allowedTools: MissionMcpSignalToolName[];
};

type MissionMcpAgentBridgeLaunchContextInput = Omit<
	MissionMcpAgentBridgeLaunchContext,
	'allowedTools'
> & {
	allowedTools: unknown;
};

const missionMcpAgentBridgeLaunchContextSchema = z.object({
	endpoint: z.string().trim().min(1),
	missionId: z.string().trim().min(1),
	taskId: z.string().trim().min(1),
	agentSessionId: z.string().trim().min(1),
	allowedTools: z.array(missionMcpSignalToolNameSchema)
}).strict();

export class MissionMcpAgentBridge {
	public readonly serverName = MISSION_MCP_SERVER_NAME;

	public readonly command = MISSION_MCP_AGENT_BRIDGE_COMMAND;

	public readonly args = [...MISSION_MCP_AGENT_BRIDGE_ARGS];

	public createLaunchEnv(input: MissionMcpAgentBridgeLaunchContext): Record<string, string> {
		const context = parseLaunchContext(input);
		return {
			[missionMcpAgentBridgeEnvKeys.endpoint]: context.endpoint,
			[missionMcpAgentBridgeEnvKeys.missionId]: context.missionId,
			[missionMcpAgentBridgeEnvKeys.taskId]: context.taskId,
			[missionMcpAgentBridgeEnvKeys.agentSessionId]: context.agentSessionId,
			[missionMcpAgentBridgeEnvKeys.allowedTools]: JSON.stringify(context.allowedTools)
		};
	}

	public readLaunchEnv(env: NodeJS.ProcessEnv): MissionMcpAgentBridgeLaunchContext {
		const rawAllowedTools = env[missionMcpAgentBridgeEnvKeys.allowedTools];
		let allowedTools: unknown = [];
		if (rawAllowedTools) {
			try {
				allowedTools = JSON.parse(rawAllowedTools);
			} catch (error) {
				throw new Error(
					`Invalid ${missionMcpAgentBridgeEnvKeys.allowedTools} value: ${(error as Error).message}`
				);
			}
		}

		return parseLaunchContext({
			endpoint: env[missionMcpAgentBridgeEnvKeys.endpoint] ?? '',
			missionId: env[missionMcpAgentBridgeEnvKeys.missionId] ?? '',
			taskId: env[missionMcpAgentBridgeEnvKeys.taskId] ?? '',
			agentSessionId: env[missionMcpAgentBridgeEnvKeys.agentSessionId] ?? '',
			allowedTools
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
		missionId: parsed.data.missionId,
		taskId: parsed.data.taskId,
		agentSessionId: parsed.data.agentSessionId,
		allowedTools: [...new Set(parsed.data.allowedTools)]
	};
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
	return issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
		return `${path}${issue.message}`;
	}).join('; ');
}
