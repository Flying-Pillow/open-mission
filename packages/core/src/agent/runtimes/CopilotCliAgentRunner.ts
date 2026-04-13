import { COPILOT_CLI_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
import {
	AgentRunner,
	type AgentRunnerTerminalTransportRuntimeOptions
} from '../AgentRunner.js';
import type { AgentSession } from '../AgentSession.js';
import type {
	AgentLaunchConfig,
	AgentRunnerCapabilities,
	AgentSessionReference
} from '../AgentRuntimeTypes.js';

export type CopilotCliAgentRunnerOptions = Omit<
	AgentRunnerTerminalTransportRuntimeOptions,
	| 'command'
> & {
	command?: string;
};

export class CopilotCliAgentRunner extends AgentRunner {
	public constructor(options: CopilotCliAgentRunnerOptions) {
		super({
			id: COPILOT_CLI_AGENT_RUNNER_ID,
			displayName: `${COPILOT_CLI_AGENT_RUNNER_ID} via terminal-manager`
		});
		this.configureTerminalTransportRuntime({
			command: options.command?.trim() || process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
			...(options.args ? { args: [...options.args] } : {}),
			...(options.env ? { env: options.env } : {}),
			...(options.sessionPrefix ? { sessionPrefix: options.sessionPrefix } : {}),
			...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
			...(options.logLine ? { logLine: options.logLine } : {}),
			...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
			...(options.sharedSessionName ? { sharedSessionName: options.sharedSessionName } : {}),
			...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
			...(options.executor ? { executor: options.executor } : {})
		});
	}

	public async getCapabilities(): Promise<AgentRunnerCapabilities> {
		return this.getTerminalCommandCapabilities();
	}

	public async isAvailable(): Promise<{ available: boolean; reason?: string }> {
		return this.isTerminalCommandRuntimeAvailable();
	}

	protected override async onStartSession(config: AgentLaunchConfig): Promise<AgentSession> {
		return this.startTerminalCommandSession(config);
	}

	protected override async onReconcileSession(reference: AgentSessionReference): Promise<AgentSession> {
		return this.reconcileTerminalCommandSession(reference);
	}
}