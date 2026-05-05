import { describe, expect, it } from 'vitest';
import { AgentSessionMcpAccessProvisioner, AgentSessionMcpProvisioningError } from './AgentSessionMcpAccessProvisioner.js';
import { MissionMcpSignalServer } from './MissionMcpSignalServer.js';
import { PolicyBoundAgentSessionSignalPort } from '../signals/AgentSessionSignalPort.js';
import { MissionMcpAgentBridge, missionMcpAgentBridgeEnvKeys } from './MissionMcpAgentBridge.js';

describe('AgentSessionMcpAccessProvisioner', () => {
	it('registers supported sessions, returns bridge env, and unregisters on cleanup', async () => {
		const server = createSignalServer();
		await server.start();
		const provisioner = new AgentSessionMcpAccessProvisioner({ signalServer: server });

		const result = await provisioner.provision({
			runnerId: 'claude-code',
			policy: 'optional',
			workingDirectory: '/tmp/work',
			missionId: 'mission-31',
			taskId: 'task-5',
			agentSessionId: 'session-7',
			allowedTools: ['mission_report_progress', 'mission_append_session_note']
		});

		expect(result.accessState).toBe('mcp-validated');
		expect(result.generatedFiles).toEqual([]);
		expect(result.launchEnv[missionMcpAgentBridgeEnvKeys.endpoint]).toContain('mission-local://mcp-signal/');
		expect(result.launchEnv[missionMcpAgentBridgeEnvKeys.missionId]).toBe('mission-31');
		expect(result.launchEnv[missionMcpAgentBridgeEnvKeys.taskId]).toBe('task-5');
		expect(result.launchEnv[missionMcpAgentBridgeEnvKeys.agentSessionId]).toBe('session-7');
		expect(JSON.parse(result.launchEnv[missionMcpAgentBridgeEnvKeys.allowedTools] ?? '[]')).toEqual([
			'mission_report_progress',
			'mission_append_session_note'
		]);
		expect(new MissionMcpAgentBridge().readLaunchEnv(result.launchEnv)).toEqual({
			endpoint: result.launchEnv[missionMcpAgentBridgeEnvKeys.endpoint] ?? '',
			missionId: 'mission-31',
			taskId: 'task-5',
			agentSessionId: 'session-7',
			allowedTools: ['mission_report_progress', 'mission_append_session_note']
		});
		await expect(server.start().then((handle) => handle.healthCheck())).resolves.toMatchObject({
			registeredSessionCount: 1
		});

		await result.cleanup();

		await expect(server.start().then((handle) => handle.healthCheck())).resolves.toMatchObject({
			registeredSessionCount: 0
		});
	});

	it('keeps the lean MCP path runner-neutral across Mission-owned coders and Copilot', async () => {
		const server = createSignalServer();
		await server.start();
		const provisioner = new AgentSessionMcpAccessProvisioner({ signalServer: server });

		for (const runnerId of ['claude-code', 'pi', 'codex', 'opencode', 'copilot-cli'] as const) {
			const result = await provisioner.provision({
				runnerId,
				policy: 'optional',
				workingDirectory: '/tmp/work',
				missionId: 'mission-31',
				taskId: `task-${runnerId}`,
				agentSessionId: `session-${runnerId}`,
				allowedTools: ['mission_report_progress']
			});

			expect(result.accessState).toBe('mcp-validated');
			expect(result.generatedFiles).toEqual([]);
			expect(result.launchEnv[missionMcpAgentBridgeEnvKeys.agentSessionId]).toBe(`session-${runnerId}`);
			await result.cleanup();
		}
	});

	it('skips registration entirely when provisioning is disabled', async () => {
		const server = createSignalServer();
		await server.start();
		const provisioner = new AgentSessionMcpAccessProvisioner({ signalServer: server });

		const result = await provisioner.provision({
			runnerId: 'claude-code',
			policy: 'disabled',
			workingDirectory: '/tmp/work',
			missionId: 'mission-31',
			taskId: 'task-disabled',
			agentSessionId: 'session-disabled',
			allowedTools: ['mission_report_progress']
		});

		expect(result.accessState).toBe('mcp-unavailable');
		expect(result.reason).toBe('MCP provisioning is disabled for this session.');
		expect(result.launchEnv).toEqual({});
		expect(result.generatedFiles).toEqual([]);
		await expect(server.start().then((handle) => handle.healthCheck())).resolves.toMatchObject({
			registeredSessionCount: 0
		});
	});

	it('degrades optional launches when session registration fails and fails required launches explicitly', async () => {
		const failingServer = {
			start: async () => ({
				serverId: 'server-fail',
				endpoint: 'mission-local://mcp-signal/fail',
				localOnly: true as const,
				transport: 'in-memory-local' as const,
				toolNames: [] as const,
				healthCheck: async () => ({
					serverId: 'server-fail',
					endpoint: 'mission-local://mcp-signal/fail',
					running: true,
					localOnly: true as const,
					transport: 'in-memory-local' as const,
					registeredSessionCount: 0
				}),
				invokeTool: async () => ({
					accepted: false,
					outcome: 'rejected' as const,
					reason: 'unused'
				})
			}),
			registerSession: async () => {
				throw new Error('registration failed');
			},
			unregisterSession: async () => undefined
		};

		const optionalProvisioner = new AgentSessionMcpAccessProvisioner({
			signalServer: failingServer
		});
		const optional = await optionalProvisioner.provision({
			runnerId: 'claude-code',
			policy: 'optional',
			workingDirectory: '/tmp/work',
			missionId: 'mission-31',
			taskId: 'task-optional',
			agentSessionId: 'session-optional',
			allowedTools: ['mission_report_progress']
		});

		expect(optional.accessState).toBe('mcp-degraded');
		expect(optional.reason).toBe('registration failed');
		expect(optional.launchEnv).toEqual({});
		expect(optional.generatedFiles).toEqual([]);

		const requiredProvisioner = new AgentSessionMcpAccessProvisioner({
			signalServer: failingServer
		});
		await expect(requiredProvisioner.provision({
			runnerId: 'claude-code',
			policy: 'required',
			workingDirectory: '/tmp/work',
			missionId: 'mission-31',
			taskId: 'task-required',
			agentSessionId: 'session-required',
			allowedTools: ['mission_report_progress']
		})).rejects.toEqual(
			new AgentSessionMcpProvisioningError('claude-code', 'registration failed')
		);
	});

	it('rejects malformed bridge launch env instead of silently dropping tool scope', () => {
		const bridge = new MissionMcpAgentBridge();

		expect(() => bridge.readLaunchEnv({
			MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/server',
			MISSION_MCP_MISSION_ID: 'mission-31',
			MISSION_MCP_TASK_ID: 'task-5',
			MISSION_MCP_AGENT_SESSION_ID: 'session-15',
			MISSION_MCP_ALLOWED_TOOLS: '{"tool":"mission_report_progress"}'
		})).toThrowError(
			'Invalid Mission MCP agent bridge context: allowedTools: Invalid input: expected array, received object'
		);
	});
});

function createSignalServer() {
	return new MissionMcpSignalServer({
		signalPort: new PolicyBoundAgentSessionSignalPort({
			sink: {
				getSnapshot: async () => undefined,
				commit: async () => undefined
			}
		})
	});
}
