import { describe, expect, it } from 'vitest';
import { buildMissionAgentRuntimeProtocolLaunchContext } from './MissionAgentRuntimeProtocolLaunchContext.js';

describe('MissionAgentRuntimeProtocolLaunchContext', () => {
	it('passes validated Mission MCP launch env through and emits MCP-first session instructions', () => {
		const context = buildMissionAgentRuntimeProtocolLaunchContext({
			provisioning: {
				runnerId: 'claude-code',
				policy: 'optional',
				accessState: 'mcp-validated',
				launchEnv: {
					MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/session-1',
					MISSION_MCP_SESSION_TOKEN: 'token-1'
				},
				generatedFiles: [],
				cleanup: async () => undefined
			},
			missionId: 'mission-31',
			taskId: 'task-6',
			agentSessionId: 'session-1'
		});

		expect(context.launchEnv).toEqual({
			MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/session-1',
			MISSION_MCP_SESSION_TOKEN: 'token-1'
		});
		expect(context.mcpAccessState).toBe('mcp-validated');
		expect(context.sessionInstructions).toContain('Mission MCP is available through the local mission server');
		expect(context.sessionInstructions).toContain('MISSION_MCP_SESSION_TOKEN');
		expect(context.sessionInstructions).toContain('progress');
		expect(context.sessionInstructions).toContain('complete');
		expect(context.sessionInstructions).toContain('entity');
	});

	it('marks degraded launches as lower-confidence fallback sessions instead of forwarding MCP env', () => {
		const context = buildMissionAgentRuntimeProtocolLaunchContext({
			provisioning: {
				runnerId: 'pi',
				policy: 'optional',
				accessState: 'mcp-unavailable',
				launchEnv: {
					MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/should-not-leak'
				},
				generatedFiles: [],
				reason: "Runner 'pi' does not support Mission MCP provisioning.",
				cleanup: async () => undefined
			},
			missionId: 'mission-31',
			taskId: 'task-6',
			agentSessionId: 'session-2'
		});

		expect(context.launchEnv).toEqual({});
		expect(context.mcpAccessState).toBe('mcp-unavailable');
		expect(context.sessionInstructions).toContain("Mission MCP is unavailable for this session: Runner 'pi' does not support Mission MCP provisioning.");
		expect(context.sessionInstructions).toContain('agentSessionId');
	});
});
