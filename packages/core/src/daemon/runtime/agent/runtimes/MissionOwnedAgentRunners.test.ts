import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { Repository } from '../../../../entities/Repository/Repository.js';
import { createDefaultRepositorySettings } from '../../../../entities/Repository/RepositorySchema.js';
import { createConfiguredAgentRunners } from './AgentRuntimeFactory.js';
import { ClaudeCodeAgentRunner } from './ClaudeCodeAgentRunner.js';
import { CopilotCliAgentRunner } from './CopilotCliAgentRunner.js';
import { CodexAgentRunner } from './CodexAgentRunner.js';
import { OpenCodeAgentRunner } from './OpenCodeAgentRunner.js';
import { PiAgentRunner } from './PiAgentRunner.js';
import { ProviderInitializationError } from './MissionAgentPtyRunner.js';

function createLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
	return {
		missionId: 'mission-31',
		workingDirectory: process.cwd(),
		task: {
			taskId: 'task-7',
			stageId: 'implementation',
			title: 'Integrate PTY launch',
			description: 'Integrate PTY launch',
			instruction: 'Integrate PTY launch.'
		},
		specification: {
			summary: 'Integrate PTY launch.',
			documents: []
		},
		resume: { mode: 'new' },
		initialPrompt: {
			source: 'engine',
			text: 'Integrate PTY launch.'
		},
		...overrides
	};
}

describe('Mission-owned agent runners', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('starts Codex in its own PTY-backed process and allows runtime reattachment', async () => {
		const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-codex-cli-'));
		const codexScriptPath = path.join(runtimeDirectory, 'codex');
		await fs.writeFile(codexScriptPath, '#!/bin/sh\nexit 0\n', {
			encoding: 'utf8',
			mode: 0o755
		});

		const state: MockTerminalState = {
			spawnedCommand: '',
			spawnedArgs: [],
			writes: [],
			killCount: 0
		};
		const spawn = createSpawn(state, () => createFakePty(state));
		const resolveSettings = () => ({
			model: 'gpt-5-codex',
			providerEnv: { OPENAI_API_KEY: 'codex-key' },
			runtimeEnv: { PATH: runtimeDirectory },
			launchEnv: { MISSION_AGENT_SESSION_ID: 'agent-session-codex' }
		});

		const runner = new CodexAgentRunner({
			resolveSettings,
			spawn,
			pollIntervalMs: 500
		});

		const launchConfig = createLaunchConfig();

		try {
			const session = await runner.startSession(launchConfig);
			const snapshot = session.getSnapshot();

			expect(snapshot.runnerId).toBe('codex');
			expect(snapshot.transport?.kind).toBe('terminal');
			expect(snapshot.transport?.paneId).toBe('pty');
			expect(snapshot.sessionId).toMatch(/^task-7-codex-[a-z0-9]{8}$/);
			expect(snapshot.transport?.terminalSessionName.endsWith(`:mission-31:task-7:${snapshot.sessionId}`)).toBe(true);
			expect(snapshot.status).toBe('running');
			expect(state.spawnedCommand).toBe('/bin/sh');
			expect(state.spawnedArgs).toEqual([
				codexScriptPath,
				'--model',
				'gpt-5-codex',
				'Integrate PTY launch.'
			]);
			expect(state.writes).toEqual([]);

			const reattachedRunner = new CodexAgentRunner({
				resolveSettings,
				spawn,
				pollIntervalMs: 500
			});

			try {
				const reattachedSession = await reattachedRunner.reconcileSession(snapshot.reference);
				const reattachedSnapshot = reattachedSession.getSnapshot();

				expect(reattachedSnapshot.sessionId).toBe(snapshot.sessionId);
				expect(reattachedSnapshot.transport?.kind).toBe('terminal');
				expect(reattachedSnapshot.transport?.terminalSessionName).toBe(
					snapshot.transport?.terminalSessionName
				);
				expect(reattachedSnapshot.status).toBe('running');

				await reattachedSession.submitPrompt({
					source: 'operator',
					text: 'Report current status.'
				});

				expect(state.writes).toContain('Report current status.');
				expect(state.writes).toContain('\r');
			} finally {
				reattachedRunner.dispose();
			}
		} finally {
			runner.dispose();
			await fs.rm(runtimeDirectory, { recursive: true, force: true });
		}
	});

	it('maps Claude Code launch plans and structured usage without any Sandcastle wrapper', () => {
		const runner = new ClaudeCodeAgentRunner({
			resolveSettings: () => ({
				model: 'claude-sonnet-4-7',
				launchMode: 'print',
				reasoningEffort: 'high',
				dangerouslySkipPermissions: true,
				resumeSession: 'claude-session-42',
				captureSessions: false,
				providerEnv: {
					ANTHROPIC_API_KEY: 'provider-key',
					SHARED: 'provider'
				},
				runtimeEnv: {
					PATH: '/usr/bin',
					SHARED: 'runtime'
				},
				launchEnv: {
					MISSION_AGENT_SESSION_ID: 'agent-session-1',
					SHARED: 'launch'
				}
			})
		});

		expect(runner.createPrintLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'print',
			command: "claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model 'claude-sonnet-4-7' --effort high --resume 'claude-session-42' -p -",
			args: [],
			stdin: 'Integrate PTY launch.',
			env: {
				PATH: '/usr/bin',
				ANTHROPIC_API_KEY: 'provider-key',
				MISSION_AGENT_SESSION_ID: 'agent-session-1',
				SHARED: 'launch'
			}
		});
		expect(runner['parseRuntimeOutputLine'](
			'{"type":"system","subtype":"init","session_id":"claude-session-42"}'
		)).toEqual([{
			kind: 'signal',
			signal: {
				type: 'provider-session',
				providerName: 'claude-code',
				sessionId: 'claude-session-42',
				source: 'provider-structured',
				confidence: 'high'
			}
		}]);
		expect(runner['parseSessionUsageContent']([
			'{"type":"system","subtype":"init","session_id":"claude-session-42"}',
			'{"type":"assistant","message":{"usage":{"input_tokens":12,"cache_creation_input_tokens":3,"cache_read_input_tokens":4,"output_tokens":5}}}'
		].join('\n'))).toEqual({
			kind: 'usage',
			payload: {
				inputTokens: 12,
				cacheCreationInputTokens: 3,
				cacheReadInputTokens: 4,
				outputTokens: 5
			}
		});
	});

	it('maps Pi, Codex, and OpenCode launch plans directly from Mission-owned runners', () => {
		const pi = new PiAgentRunner({
			resolveSettings: () => ({
				model: 'pi-large',
				providerEnv: { PI_API_KEY: 'pi-key' },
				runtimeEnv: { PATH: '/usr/local/bin' },
				launchEnv: { MISSION_AGENT_SESSION_ID: 'agent-session-2' }
			})
		});
		const codex = new CodexAgentRunner({
			resolveSettings: () => ({
				model: 'gpt-5-codex',
				reasoningEffort: 'xhigh',
				providerEnv: { OPENAI_API_KEY: 'codex-key' }
			})
		});
		const opencode = new OpenCodeAgentRunner({
			resolveSettings: () => ({
				model: 'opencode-1',
				providerEnv: { OPENCODE_TOKEN: 'token' }
			})
		});

		expect(pi.createInteractiveLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'interactive',
			command: 'pi',
			args: ['--model', 'pi-large', 'Integrate PTY launch.'],
			env: {
				PATH: '/usr/local/bin',
				PI_API_KEY: 'pi-key',
				MISSION_AGENT_SESSION_ID: 'agent-session-2'
			}
		});
		expect(pi.createPrintLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'print',
			command: "pi -p --mode json --no-session --model 'pi-large'",
			args: [],
			stdin: 'Integrate PTY launch.',
			env: {
				PATH: '/usr/local/bin',
				PI_API_KEY: 'pi-key',
				MISSION_AGENT_SESSION_ID: 'agent-session-2'
			}
		});
		expect(pi['parseRuntimeOutputLine'](
			'{"type":"tool_execution_start","toolName":"Bash","args":{"command":"pnpm test"}}'
		)).toEqual([{
			kind: 'signal',
			signal: {
				type: 'tool-call',
				toolName: 'Bash',
				args: 'pnpm test',
				source: 'provider-structured',
				confidence: 'medium'
			}
		}]);

		expect(codex.createInteractiveLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'interactive',
			command: 'codex',
			args: ['--model', 'gpt-5-codex', 'Integrate PTY launch.'],
			env: {
				OPENAI_API_KEY: 'codex-key'
			}
		});
		expect(codex.createPrintLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'print',
			command: `codex exec --json --dangerously-bypass-approvals-and-sandbox -m 'gpt-5-codex' -c 'model_reasoning_effort="xhigh"'`,
			args: [],
			stdin: 'Integrate PTY launch.',
			env: {
				OPENAI_API_KEY: 'codex-key'
			}
		});
		expect(codex['parseRuntimeOutputLine'](
			'{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}'
		)).toEqual([{
			kind: 'message',
			channel: 'agent',
			text: 'Done.'
		}]);

		expect(opencode.createInteractiveLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'interactive',
			command: 'opencode',
			args: ['--model', 'opencode-1', '-p', 'Integrate PTY launch.'],
			env: {
				OPENCODE_TOKEN: 'token'
			}
		});
		expect(opencode.createPrintLaunchPlan(createLaunchConfig())).toEqual({
			mode: 'print',
			command: "opencode run --model 'opencode-1' 'Integrate PTY launch.'",
			args: [],
			env: {
				OPENCODE_TOKEN: 'token'
			}
		});
		expect(opencode['parseRuntimeOutputLine']('plain text without structured output')).toEqual([{ kind: 'none' }]);
	});

	it('passes Mission MCP session env through without runner-specific MCP config mutation', async () => {
		const missionMcpEnv = {
			MISSION_MCP_ENDPOINT: 'mission-local://mcp-signal/session-1',
			MISSION_MCP_SESSION_TOKEN: 'token-1'
		};
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-mcp-runner-test-'));
		try {
			const copilot = new CopilotCliAgentRunner({
				command: 'copilot',
				trustedConfigDir: workspaceRoot,
				env: { PATH: '/usr/bin' }
			});
			const claudeCode = new ClaudeCodeAgentRunner({
				resolveSettings: () => ({
					model: 'claude-sonnet-4-7',
					providerEnv: { ANTHROPIC_API_KEY: 'claude-key' },
					launchEnv: missionMcpEnv
				})
			});
			const codex = new CodexAgentRunner({
				resolveSettings: () => ({
					model: 'gpt-5.3-codex',
					providerEnv: { OPENAI_API_KEY: 'codex-key' },
					launchEnv: missionMcpEnv
				})
			});
			const opencode = new OpenCodeAgentRunner({
				resolveSettings: () => ({
					model: 'opencode-1',
					providerEnv: { OPENCODE_TOKEN: 'token' },
					launchEnv: missionMcpEnv
				})
			});
			const pi = new PiAgentRunner({
				resolveSettings: () => ({
					model: 'pi-large',
					providerEnv: { PI_API_KEY: 'pi-key' },
					launchEnv: missionMcpEnv
				})
			});

			const copilotPlan = copilot.createInteractiveLaunchPlan(createLaunchConfig({
				workingDirectory: workspaceRoot,
				launchEnv: missionMcpEnv
			}));
			expect(copilotPlan.args).not.toContain('--additional-mcp-config');
			expect(copilotPlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const claudeCodePlan = claudeCode.createInteractiveLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(claudeCodePlan.args).not.toContain('--mcp-config');
			expect(claudeCodePlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const claudeCodePrintPlan = claudeCode.createPrintLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(claudeCodePrintPlan.command).not.toContain('--mcp-config');
			expect(claudeCodePrintPlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const codexPlan = codex.createInteractiveLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(codexPlan.args).not.toContain('-c');
			expect(codexPlan.args).not.toContain('mcp_servers.mission.enabled=true');
			expect(codexPlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const codexPrintPlan = codex.createPrintLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(codexPrintPlan.command).not.toContain('mcp_servers.mission.enabled=true');
			expect(codexPrintPlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const openCodePlan = opencode.createInteractiveLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(openCodePlan.env?.['OPENCODE_CONFIG_CONTENT']).toBeUndefined();
			expect(openCodePlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);

			const piPlan = pi.createInteractiveLaunchPlan(createLaunchConfig({
				launchEnv: missionMcpEnv
			}));
			expect(piPlan.args).not.toContain('-e');
			expect(piPlan.args).not.toContain('npm:pi-mcp-extension');
			expect(piPlan.env?.['PI_CODING_AGENT_DIR']).toBeUndefined();
			expect(piPlan.env?.['MISSION_MCP_ENDPOINT']).toBe(missionMcpEnv['MISSION_MCP_ENDPOINT']);
			expect(piPlan.env?.['MISSION_MCP_SESSION_TOKEN']).toBe(missionMcpEnv['MISSION_MCP_SESSION_TOKEN']);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('factory registers the four direct Mission-owned coder runners explicitly', async () => {
		vi.spyOn(Repository, 'readSettingsDocument').mockReturnValue({
			...createDefaultRepositorySettings(),
			defaultModel: 'claude-sonnet-4-7'
		});

		const runners = await createConfiguredAgentRunners({
			repositoryRootPath: '/tmp/repo'
		});

		expect(runners.map((runner) => runner.id)).toEqual([
			'copilot-cli',
			'claude-code',
			'pi',
			'codex',
			'opencode'
		]);
		expect(runners[1]).toBeInstanceOf(ClaudeCodeAgentRunner);
		expect(runners[2]).toBeInstanceOf(PiAgentRunner);
		expect(runners[3]).toBeInstanceOf(CodexAgentRunner);
		expect(runners[4]).toBeInstanceOf(OpenCodeAgentRunner);
	});

	it('applies repository default model and runner-aware default reasoning effort', async () => {
		vi.spyOn(Repository, 'readSettingsDocument').mockReturnValue({
			...createDefaultRepositorySettings(),
			defaultModel: 'gpt-5-codex',
			defaultReasoningEffort: 'high'
		});

		const runners = await createConfiguredAgentRunners({
			repositoryRootPath: '/tmp/repo'
		});
		const codex = runners[3] as CodexAgentRunner;
		const pi = runners[2] as PiAgentRunner;

		expect(codex.createPrintLaunchPlan(createLaunchConfig())).toMatchObject({
			mode: 'print',
			command: `codex exec --json --dangerously-bypass-approvals-and-sandbox -m 'gpt-5-codex' -c 'model_reasoning_effort="high"'`,
			args: [],
			stdin: 'Integrate PTY launch.'
		});
		expect(pi.createInteractiveLaunchPlan(createLaunchConfig())).toMatchObject({
			mode: 'interactive',
			command: 'pi',
			args: ['--model', 'gpt-5-codex', 'Integrate PTY launch.']
		});
	});

	it('fails clearly when unsupported runner settings are requested', () => {
		const runner = new PiAgentRunner({
			resolveSettings: () => ({
				model: 'pi-large',
				reasoningEffort: 'high'
			})
		});

		expect(() => runner.createInteractiveLaunchPlan(createLaunchConfig())).toThrowError(
			new ProviderInitializationError(
				'pi',
				"Runner 'pi' does not support a reasoning effort option."
			)
		);
	});
});

type MockTerminalState = {
	spawnedCommand: string;
	spawnedArgs: string[];
	writes: string[];
	killCount: number;
};

type FakePty = IPty & {
	writes: string[];
	killCount: number;
	emitExit(exitCode?: number): void;
};

function createSpawn(
	state: MockTerminalState,
	createPty: () => FakePty
): (command: string, args: string | string[]) => FakePty {
	return ((command: string, args: string | string[]) => {
		state.spawnedCommand = command;
		state.spawnedArgs = Array.isArray(args) ? [...args] : [args];
		return createPty();
	}) as never;
}

function createFakePty(state: MockTerminalState): FakePty {
	let onDataListener: ((chunk: string) => void) | undefined;
	let onExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
	const fakePty = {
		pid: 1,
		process: 'fake-shell',
		cols: 120,
		rows: 32,
		handleFlowControl: false,
		writes: [] as string[],
		killCount: 0,
		write(data: string) {
			fakePty.writes.push(data);
			state.writes.push(data);
			onDataListener?.(data);
		},
		resize() { },
		kill() {
			fakePty.killCount += 1;
			state.killCount += 1;
			onExitListener?.({ exitCode: 0 });
		},
		clear() { },
		onData(listener: (chunk: string) => void) {
			onDataListener = listener;
			return { dispose() { } };
		},
		onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
			onExitListener = listener;
			return { dispose() { } };
		},
		emitExit(exitCode = 0) {
			onExitListener?.({ exitCode });
		},
		pause() { },
		resume() { },
		addListener() {
			return fakePty;
		},
		on() {
			return fakePty;
		},
		once() {
			return fakePty;
		},
		removeListener() {
			return fakePty;
		},
		removeAllListeners() {
			return fakePty;
		},
		emit() {
			return true;
		}
	} as FakePty;

	return fakePty;
}
