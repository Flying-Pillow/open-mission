import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { PI_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
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
	resolveMissionAgentRunnerSettings
} from './MissionAgentPtyRunner.js';

export type PiAgentRunnerOptions = ConstructorParameters<typeof MissionAgentPtyRunner>[0] & {
	resolveSettings?: MissionAgentRunnerSettingsResolver<typeof PI_AGENT_RUNNER_ID>;
};

export class PiAgentRunner extends MissionAgentPtyRunner {
	private readonly resolveSettings: MissionAgentRunnerSettingsResolver<typeof PI_AGENT_RUNNER_ID> | undefined;

	public constructor(options: Omit<PiAgentRunnerOptions, 'id' | 'command'> = {}) {
		super({
			id: PI_AGENT_RUNNER_ID,
			command: 'pi',
			...options
		});
		this.resolveSettings = options.resolveSettings;
	}

	public createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const prompt = config.initialPrompt?.text ?? '';
		const args = [
			'--model',
			settings.model,
			prompt
		];
		return {
			mode: 'interactive',
			command: 'pi',
			args,
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, settings.launchEnv)
		};
	}

	public createPrintLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		return {
			mode: 'print',
			command: `pi -p --mode json --no-session --model ${quoteShellArg(settings.model)}`,
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
		if (getStringField(parsed, 'type') === 'tool_execution_start') {
			const toolName = getStringField(parsed, 'toolName');
			const args = getNestedRecord(parsed, 'args');
			if (toolName) {
				return [{
					kind: 'signal',
					signal: {
						type: 'tool-call',
						toolName,
						args: typeof args?.['command'] === 'string'
							? args['command']
							: JSON.stringify(args ?? {}),
						source: 'provider-structured',
						confidence: 'medium'
					}
				}];
			}
		}
		return [{ kind: 'none' }];
	}

	private readSettings(config: AgentLaunchConfig) {
		const settings = resolveMissionAgentRunnerSettings({
			config,
			runnerId: PI_AGENT_RUNNER_ID,
			...(this.resolveSettings ? { resolveSettings: this.resolveSettings } : {})
		});
		if (settings.reasoningEffort) {
			throw new ProviderInitializationError(
				PI_AGENT_RUNNER_ID,
				"Runner 'pi' does not support a reasoning effort option."
			);
		}
		if (settings.dangerouslySkipPermissions) {
			throw new ProviderInitializationError(
				PI_AGENT_RUNNER_ID,
				"Runner 'pi' does not support configurable permission bypass."
			);
		}
		if (settings.captureSessions) {
			throw new ProviderInitializationError(
				PI_AGENT_RUNNER_ID,
				"Runner 'pi' does not support enabling session capture."
			);
		}
		if (settings.resumeSession) {
			throw new ProviderInitializationError(
				PI_AGENT_RUNNER_ID,
				`Runner 'pi' does not support resumeSession for ${settings.launchMode} launch plans.`
			);
		}
		return settings;
	}
}
