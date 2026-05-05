import { describe, expect, it } from 'vitest';
import { buildMissionAgentRuntimeProtocolLaunchContext } from './MissionAgentRuntimeProtocolLaunchContext.js';
import { MISSION_PROTOCOL_MARKER_PREFIX } from '../signals/MissionProtocolMarkerParser.js';

describe('MissionAgentRuntimeProtocolLaunchContext', () => {
	it('passes validated Mission MCP launch env through and emits MCP-first session instructions', () => {
		const context = buildMissionAgentRuntimeProtocolLaunchContext({
			provisioning: {
				runnerId: 'claude-code',
				policy: 'optional',
				accessState: 'mcp-validated',
				launchEnv: {
					MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/session-1',
					MISSION_MCP_MISSION_ID: 'mission-31',
					MISSION_MCP_TASK_ID: 'task-6',
					MISSION_MCP_AGENT_SESSION_ID: 'session-1',
					MISSION_MCP_ALLOWED_TOOLS: '["mission_report_progress"]'
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
			MISSION_MCP_MISSION_ID: 'mission-31',
			MISSION_MCP_TASK_ID: 'task-6',
			MISSION_MCP_AGENT_SESSION_ID: 'session-1',
			MISSION_MCP_ALLOWED_TOOLS: '["mission_report_progress"]'
		});
		expect(context.mcpAccessState).toBe('mcp-validated');
		expect(context.sessionInstructions).toContain('Mission MCP is available for this session');
		expect(context.sessionInstructions).toContain('MISSION_MCP_ENDPOINT');
		expect(context.sessionInstructions).toContain('mission mcp agent-bridge');
		expect(context.sessionInstructions).toContain('mission_report_progress');
		expect(context.sessionInstructions).toContain('mission_report_completion_claim');
		expect(context.sessionInstructions).toContain('do not prove verification or completion');
		expect(context.sessionInstructions).not.toContain(`${MISSION_PROTOCOL_MARKER_PREFIX}{`);
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
		expect(context.sessionInstructions).toContain('lower-confidence agent declarations');
		expect(context.sessionInstructions).toContain(MISSION_PROTOCOL_MARKER_PREFIX);
		expect(context.sessionInstructions).toContain('"missionId":"mission-31"');
		expect(context.sessionInstructions).toContain('"taskId":"task-6"');
		expect(context.sessionInstructions).toContain('"agentSessionId":"session-2"');
		expect(context.sessionInstructions).toContain('ready_for_verification and completed_claim do not prove verification or completion');
	});
});
