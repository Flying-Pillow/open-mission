import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { CODEX_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
import {
	getNestedRecord,
	getStringField,
	mergeLaunchEnv,
	MissionAgentPtyRunner,
	type MissionAgentRunnerLaunchPlan,
	type MissionAgentRunnerSettingsResolver,
	parseJsonLine,
	ProviderInitializationError,
	quoteShellArg,
	resolveMissionAgentRunnerSettings,
	validateReasoningEffort
} from './MissionAgentPtyRunner.js';
import {
	buildCodexMissionMcpOverrideArgs,
	hasMissionMcpBridgeLaunchEnv
} from '../mcp/MissionMcpRunnerLaunchSupport.js';

const CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexAgentRunnerOptions = ConstructorParameters<typeof MissionAgentPtyRunner>[0] & {
	resolveSettings?: MissionAgentRunnerSettingsResolver<typeof CODEX_AGENT_RUNNER_ID>;
};

export class CodexAgentRunner extends MissionAgentPtyRunner {
	private readonly resolveSettings: MissionAgentRunnerSettingsResolver<typeof CODEX_AGENT_RUNNER_ID> | undefined;

	public constructor(options: Omit<CodexAgentRunnerOptions, 'id' | 'command'> = {}) {
		super({
			id: CODEX_AGENT_RUNNER_ID,
			command: 'codex',
			...options
		});
		this.resolveSettings = options.resolveSettings;
	}

	public createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const prompt = config.initialPrompt?.text ?? '';
		const mcpOverrideArgs = hasMissionMcpBridgeLaunchEnv(settings.launchEnv)
			? buildCodexMissionMcpOverrideArgs(settings.launchEnv)
			: [];
		return {
			mode: 'interactive',
			command: 'codex',
			args: ['--model', settings.model, ...mcpOverrideArgs, prompt],
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, settings.launchEnv)
		};
	}

	public createPrintLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const parts = [
			'codex',
			'exec',
			'--json',
			'--dangerously-bypass-approvals-and-sandbox',
			'-m',
			quoteShellArg(settings.model),
			...(settings.reasoningEffort
				? ['-c', quoteShellArg(`model_reasoning_effort="${settings.reasoningEffort}"`)]
				: [])
		];
		if (hasMissionMcpBridgeLaunchEnv(settings.launchEnv)) {
			for (const [index, value] of buildCodexMissionMcpOverrideArgs(settings.launchEnv).entries()) {
				parts.push(index % 2 === 0 ? value : quoteShellArg(value));
			}
		}
		return {
			mode: 'print',
			command: parts.join(' '),
			args: [],
			stdin: config.initialPrompt?.text ?? '',
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, settings.launchEnv)
		};
	}

	protected override parseRuntimeOutputLine(line: string): AgentProviderObservation[] {
		const parsed = parseJsonLine(line);
		if (!parsed) {
			return [{ kind: 'none' }];
		}
		const item = getNestedRecord(parsed, 'item');
		if (getStringField(parsed, 'type') === 'item.completed'
			&& item
			&& getStringField(item, 'type') === 'agent_message') {
			const text = getStringField(item, 'text');
			if (text) {
				return [{ kind: 'message', channel: 'agent', text }];
			}
		}
		return [{ kind: 'none' }];
	}

	private readSettings(config: AgentLaunchConfig) {
		const settings = resolveMissionAgentRunnerSettings({
			config,
			runnerId: CODEX_AGENT_RUNNER_ID,
			...(this.resolveSettings ? { resolveSettings: this.resolveSettings } : {})
		});
		validateReasoningEffort(
			CODEX_AGENT_RUNNER_ID,
			settings.reasoningEffort,
			CODEX_REASONING_EFFORTS
		);
		if (settings.dangerouslySkipPermissions) {
			throw new ProviderInitializationError(
				CODEX_AGENT_RUNNER_ID,
				"Runner 'codex' does not support configurable permission bypass."
			);
		}
		if (settings.captureSessions) {
			throw new ProviderInitializationError(
				CODEX_AGENT_RUNNER_ID,
				"Runner 'codex' does not support enabling session capture."
			);
		}
		if (settings.resumeSession) {
			throw new ProviderInitializationError(
				CODEX_AGENT_RUNNER_ID,
				`Runner 'codex' does not support resumeSession for ${settings.launchMode} launch plans.`
			);
		}
		return settings;
	}
}
