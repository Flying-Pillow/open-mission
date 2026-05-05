import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { OPENCODE_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
import {
	mergeLaunchEnv,
	MissionAgentPtyRunner,
	type MissionAgentRunnerLaunchPlan,
	type MissionAgentRunnerSettingsResolver,
	ProviderInitializationError,
	quoteShellArg,
	resolveMissionAgentRunnerSettings
} from './MissionAgentPtyRunner.js';
import {
	buildOpenCodeMissionMcpConfigContent,
	hasMissionMcpBridgeLaunchEnv
} from '../mcp/MissionMcpRunnerLaunchSupport.js';

export type OpenCodeAgentRunnerOptions = ConstructorParameters<typeof MissionAgentPtyRunner>[0] & {
	resolveSettings?: MissionAgentRunnerSettingsResolver<typeof OPENCODE_AGENT_RUNNER_ID>;
};

export class OpenCodeAgentRunner extends MissionAgentPtyRunner {
	private readonly resolveSettings: MissionAgentRunnerSettingsResolver<typeof OPENCODE_AGENT_RUNNER_ID> | undefined;

	public constructor(options: Omit<OpenCodeAgentRunnerOptions, 'id' | 'command'> = {}) {
		super({
			id: OPENCODE_AGENT_RUNNER_ID,
			command: 'opencode',
			...options
		});
		this.resolveSettings = options.resolveSettings;
	}

	public createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const prompt = config.initialPrompt?.text ?? '';
		const launchEnv = hasMissionMcpBridgeLaunchEnv(settings.launchEnv)
			? {
				...settings.launchEnv,
				OPENCODE_CONFIG_CONTENT: buildOpenCodeMissionMcpConfigContent(settings.launchEnv)
			}
			: settings.launchEnv;
		return {
			mode: 'interactive',
			command: 'opencode',
			args: ['--model', settings.model, '-p', prompt],
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, launchEnv)
		};
	}

	public createPrintLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const launchEnv = hasMissionMcpBridgeLaunchEnv(settings.launchEnv)
			? {
				...settings.launchEnv,
				OPENCODE_CONFIG_CONTENT: buildOpenCodeMissionMcpConfigContent(settings.launchEnv)
			}
			: settings.launchEnv;
		return {
			mode: 'print',
			command: `opencode run --model ${quoteShellArg(settings.model)} ${quoteShellArg(config.initialPrompt?.text ?? '')}`,
			args: [],
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, launchEnv)
		};
	}

	protected override parseRuntimeOutputLine(_line: string): AgentProviderObservation[] {
		return [{ kind: 'none' }];
	}

	private readSettings(config: AgentLaunchConfig) {
		const settings = resolveMissionAgentRunnerSettings({
			config,
			runnerId: OPENCODE_AGENT_RUNNER_ID,
			...(this.resolveSettings ? { resolveSettings: this.resolveSettings } : {})
		});
		if (settings.reasoningEffort) {
			throw new ProviderInitializationError(
				OPENCODE_AGENT_RUNNER_ID,
				"Runner 'opencode' does not support a reasoning effort option."
			);
		}
		if (settings.dangerouslySkipPermissions) {
			throw new ProviderInitializationError(
				OPENCODE_AGENT_RUNNER_ID,
				"Runner 'opencode' does not support configurable permission bypass."
			);
		}
		if (settings.captureSessions) {
			throw new ProviderInitializationError(
				OPENCODE_AGENT_RUNNER_ID,
				"Runner 'opencode' does not support enabling session capture."
			);
		}
		if (settings.resumeSession) {
			throw new ProviderInitializationError(
				OPENCODE_AGENT_RUNNER_ID,
				`Runner 'opencode' does not support resumeSession for ${settings.launchMode} launch plans.`
			);
		}
		return settings;
	}
}
