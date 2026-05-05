import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import {
	MISSION_MCP_AGENT_BRIDGE_ARGS,
	MISSION_MCP_AGENT_BRIDGE_COMMAND,
	missionMcpAgentBridgeEnvKeys
} from './MissionMcpAgentBridge.js';

export type MissionMcpBridgeLaunchEnv = Partial<Record<
	typeof missionMcpAgentBridgeEnvKeys[keyof typeof missionMcpAgentBridgeEnvKeys],
	string
>>;

export function hasMissionMcpBridgeLaunchEnv(env: Record<string, string> | undefined): env is Record<string, string> {
	if (!env) return false;
	return typeof env[missionMcpAgentBridgeEnvKeys.endpoint] === 'string'
		&& env[missionMcpAgentBridgeEnvKeys.endpoint]!.trim().length > 0
		&& typeof env[missionMcpAgentBridgeEnvKeys.missionId] === 'string'
		&& env[missionMcpAgentBridgeEnvKeys.missionId]!.trim().length > 0
		&& typeof env[missionMcpAgentBridgeEnvKeys.taskId] === 'string'
		&& env[missionMcpAgentBridgeEnvKeys.taskId]!.trim().length > 0
		&& typeof env[missionMcpAgentBridgeEnvKeys.agentSessionId] === 'string'
		&& env[missionMcpAgentBridgeEnvKeys.agentSessionId]!.trim().length > 0
		&& typeof env[missionMcpAgentBridgeEnvKeys.allowedTools] === 'string'
		&& env[missionMcpAgentBridgeEnvKeys.allowedTools]!.trim().length > 0;
}

export function buildMissionMcpBridgeServerEnv(
	env: Record<string, string>
): Record<string, string> {
	return {
		[missionMcpAgentBridgeEnvKeys.endpoint]: env[missionMcpAgentBridgeEnvKeys.endpoint] ?? '',
		[missionMcpAgentBridgeEnvKeys.missionId]: env[missionMcpAgentBridgeEnvKeys.missionId] ?? '',
		[missionMcpAgentBridgeEnvKeys.taskId]: env[missionMcpAgentBridgeEnvKeys.taskId] ?? '',
		[missionMcpAgentBridgeEnvKeys.agentSessionId]: env[missionMcpAgentBridgeEnvKeys.agentSessionId] ?? '',
		[missionMcpAgentBridgeEnvKeys.allowedTools]: env[missionMcpAgentBridgeEnvKeys.allowedTools] ?? '[]'
	};
}

export function buildCodexMissionMcpOverrideArgs(env: Record<string, string>): string[] {
	const bridgeEnv = buildMissionMcpBridgeServerEnv(env);
	return [
		'-c',
		`mcp_servers.mission.command=${JSON.stringify(MISSION_MCP_AGENT_BRIDGE_COMMAND)}`,
		'-c',
		`mcp_servers.mission.args=${JSON.stringify([...MISSION_MCP_AGENT_BRIDGE_ARGS])}`,
		'-c',
		'mcp_servers.mission.enabled=true',
		...Object.entries(bridgeEnv).flatMap(([key, value]) => [
			'-c',
			`mcp_servers.mission.env.${key}=${JSON.stringify(value)}`
		])
	];
}

export function buildOpenCodeMissionMcpConfigContent(env: Record<string, string>): string {
	return JSON.stringify({
		mcp: {
			mission: {
				type: 'local',
				command: [MISSION_MCP_AGENT_BRIDGE_COMMAND, ...MISSION_MCP_AGENT_BRIDGE_ARGS],
				enabled: true,
				environment: buildMissionMcpBridgeServerEnv(env)
			}
		}
	});
}

export function findNearestMissionMcpConfigPath(workingDirectory: string): string | undefined {
	let current = path.resolve(workingDirectory);
	while (true) {
		const candidate = path.join(current, '.mcp.json');
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

export async function createPiMissionMcpConfigDir(env: Record<string, string>): Promise<{
	configDir: string;
	cleanup(): Promise<void>;
}> {
	const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-pi-mcp-'));
	await fs.writeFile(
		path.join(configDir, 'mcp.json'),
		`${JSON.stringify({
			mcpServers: {
				mission: {
					transport: 'stdio',
					command: MISSION_MCP_AGENT_BRIDGE_COMMAND,
					args: [...MISSION_MCP_AGENT_BRIDGE_ARGS],
					env: buildMissionMcpBridgeServerEnv(env)
				}
			}
		}, null, 2)}\n`,
		'utf8'
	);
	return {
		configDir,
		cleanup: async () => {
			await fs.rm(configDir, { recursive: true, force: true });
		}
	};
}
