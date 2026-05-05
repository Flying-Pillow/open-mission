import type {
	AgentSessionMcpAccessState,
	AgentSessionMcpProvisioningResult
} from './AgentSessionMcpAccessProvisioner.js';
import {
	MISSION_MCP_AGENT_BRIDGE_ARGS,
	MISSION_MCP_AGENT_BRIDGE_COMMAND,
	missionMcpAgentBridgeEnvKeys
} from './MissionMcpAgentBridge.js';
import { missionMcpSignalToolNames } from './MissionMcpSignalTools.js';
import { MISSION_PROTOCOL_MARKER_PREFIX } from '../signals/MissionProtocolMarkerParser.js';

export type MissionAgentRuntimeProtocolLaunchContext = {
	launchEnv: Record<string, string>;
	sessionInstructions: string;
	mcpAccessState: AgentSessionMcpAccessState;
};

export function buildMissionAgentRuntimeProtocolLaunchContext(input: {
	provisioning: AgentSessionMcpProvisioningResult;
	missionId: string;
	taskId: string;
	agentSessionId: string;
}): MissionAgentRuntimeProtocolLaunchContext {
	const { provisioning } = input;
	return {
		launchEnv: provisioning.accessState === 'mcp-validated'
			? { ...provisioning.launchEnv }
			: {},
		sessionInstructions: provisioning.accessState === 'mcp-validated'
			? buildValidatedSessionInstructions()
			: buildFallbackSessionInstructions(input),
		mcpAccessState: provisioning.accessState
	};
}

function buildValidatedSessionInstructions(): string {
	const endpointEnvVar = missionMcpAgentBridgeEnvKeys.endpoint;
	const bridgeCommand = [MISSION_MCP_AGENT_BRIDGE_COMMAND, ...MISSION_MCP_AGENT_BRIDGE_ARGS].join(' ');
	const toolList = missionMcpSignalToolNames.map((toolName) => `- ${toolName}`).join('\n');

	return [
		'Mission runtime protocol for this session:',
		'- Mission MCP is available for this session through the local mission server.',
		`- The session launch environment includes ${endpointEnvVar} and the corresponding Mission session identity fields.`,
		`- If your tooling needs an explicit MCP bridge command, use: ${bridgeCommand}`,
		'- Use Mission MCP first for structured progress, needs-input, blocked, ready-for-verification, completion/failure claims, notes, and usage.',
		'- Every MCP tool call must include missionId, taskId, agentSessionId, and a unique eventId.',
		'- Mission acknowledgements and your own claims do not prove verification or completion; they remain advisory until Mission policy and deterministic checks confirm them.',
		'Available Mission MCP tools:',
		toolList,
		'- Emit fallback protocol markers only if Mission MCP becomes unavailable or degraded later in the session.'
	].join('\n');
}

function buildFallbackSessionInstructions(input: {
	provisioning: AgentSessionMcpProvisioningResult;
	missionId: string;
	taskId: string;
	agentSessionId: string;
}): string {
	const markerExample = `${MISSION_PROTOCOL_MARKER_PREFIX}${JSON.stringify({
		version: 1,
		missionId: input.missionId,
		taskId: input.taskId,
		agentSessionId: input.agentSessionId,
		eventId: 'event-id',
		signal: {
			type: 'progress',
			summary: 'Implemented the requested change.'
		}
	})}`;
	const degradedLine = input.provisioning.reason
		? `- Mission MCP is ${formatAccessState(input.provisioning.accessState)} for this session: ${input.provisioning.reason}`
		: `- Mission MCP is ${formatAccessState(input.provisioning.accessState)} for this session.`;

	return [
		'Mission runtime protocol for this session:',
		degradedLine,
		'- Treat stdout fallback markers as lower-confidence agent declarations, not authoritative Mission state.',
		`- When reporting structured state, emit a single-line marker that starts with ${MISSION_PROTOCOL_MARKER_PREFIX} and is immediately followed by strict JSON.`,
		'- The JSON must include version, missionId, taskId, agentSessionId, eventId, and signal.',
		'- Supported signal payloads are progress, needs_input, blocked, ready_for_verification, completed_claim, failed_claim, and message.',
		'- Keep each eventId unique and keep the marker scoped to this session.',
		'- ready_for_verification and completed_claim do not prove verification or completion; Mission policy still decides what is promoted.',
		'Example marker:',
		markerExample
	].join('\n');
}

function formatAccessState(accessState: AgentSessionMcpAccessState): string {
	switch (accessState) {
		case 'mcp-degraded':
			return 'degraded';
		case 'mcp-unavailable':
			return 'unavailable';
		case 'mcp-validated':
			return 'validated';
	}
}
