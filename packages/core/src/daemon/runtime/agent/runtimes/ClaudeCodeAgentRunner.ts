import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { CLAUDE_CODE_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
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
	validateCaptureSessions,
	validateDangerouslySkipPermissions,
	validateReasoningEffort
} from './MissionAgentPtyRunner.js';

const CLAUDE_REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;

export type ClaudeCodeAgentRunnerOptions = ConstructorParameters<typeof MissionAgentPtyRunner>[0] & {
	resolveSettings?: MissionAgentRunnerSettingsResolver<typeof CLAUDE_CODE_AGENT_RUNNER_ID>;
};

export class ClaudeCodeAgentRunner extends MissionAgentPtyRunner {
	private readonly resolveSettings: MissionAgentRunnerSettingsResolver<typeof CLAUDE_CODE_AGENT_RUNNER_ID> | undefined;

	public constructor(options: Omit<ClaudeCodeAgentRunnerOptions, 'id' | 'command'> = {}) {
		super({
			id: CLAUDE_CODE_AGENT_RUNNER_ID,
			command: 'claude',
			...options
		});
		this.resolveSettings = options.resolveSettings;
	}

	public createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		if (settings.resumeSession) {
			throw new ProviderInitializationError(
				CLAUDE_CODE_AGENT_RUNNER_ID,
				"Runner 'claude-code' does not support resumeSession for interactive launch plans."
			);
		}
		const prompt = config.initialPrompt?.text ?? '';
		const args = [
			'--verbose',
			'--output-format',
			'stream-json',
			'--model',
			settings.model,
			...(settings.reasoningEffort ? ['--effort', settings.reasoningEffort] : []),
			...(settings.dangerouslySkipPermissions ? ['--dangerously-skip-permissions'] : []),
			prompt
		];
		return {
			mode: 'interactive',
			command: 'claude',
			args,
			env: mergeLaunchEnv(settings.runtimeEnv, settings.providerEnv, settings.launchEnv)
		};
	}

	public createPrintLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const settings = this.readSettings(config);
		const parts = [
			'claude',
			'--print',
			'--verbose',
			...(settings.dangerouslySkipPermissions ? ['--dangerously-skip-permissions'] : []),
			'--output-format',
			'stream-json',
			'--model',
			quoteShellArg(settings.model),
			...(settings.reasoningEffort ? ['--effort', settings.reasoningEffort] : []),
			...(settings.resumeSession ? ['--resume', quoteShellArg(settings.resumeSession)] : []),
			'-p',
			'-'
		];
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

		if (getStringField(parsed, 'type') === 'system'
			&& getStringField(parsed, 'subtype') === 'init') {
			const sessionId = getStringField(parsed, 'session_id');
			if (sessionId) {
				return [{
					kind: 'signal',
					signal: {
						type: 'provider-session',
						providerName: 'claude-code',
						sessionId,
						source: 'provider-structured',
						confidence: 'high'
					}
				}];
			}
		}

		const result = getStringField(parsed, 'result');
		if (result) {
			return [{ kind: 'message', channel: 'agent', text: result }];
		}

		const message = getNestedRecord(parsed, 'message');
		const messageText = message ? getStringField(message, 'text') ?? getStringField(message, 'content') : undefined;
		if (messageText) {
			return [{ kind: 'message', channel: 'agent', text: messageText }];
		}

		return [{ kind: 'none' }];
	}

	protected override parseSessionUsageContent(content: string): AgentProviderObservation | undefined {
		let usageRecord: Record<string, unknown> | undefined;
		for (const line of content.split('\n')) {
			const parsed = parseJsonLine(line);
			if (!parsed) {
				continue;
			}
			const message = getNestedRecord(parsed, 'message');
			const usage = message ? getNestedRecord(message, 'usage') : undefined;
			if (usage) {
				usageRecord = usage;
			}
		}
		if (!usageRecord) {
			return undefined;
		}

		return {
			kind: 'usage',
			payload: {
				...(typeof usageRecord['input_tokens'] === 'number'
					? { inputTokens: usageRecord['input_tokens'] }
					: {}),
				...(typeof usageRecord['cache_creation_input_tokens'] === 'number'
					? { cacheCreationInputTokens: usageRecord['cache_creation_input_tokens'] }
					: {}),
				...(typeof usageRecord['cache_read_input_tokens'] === 'number'
					? { cacheReadInputTokens: usageRecord['cache_read_input_tokens'] }
					: {}),
				...(typeof usageRecord['output_tokens'] === 'number'
					? { outputTokens: usageRecord['output_tokens'] }
					: {})
			}
		};
	}

	private readSettings(config: AgentLaunchConfig) {
		const settings = resolveMissionAgentRunnerSettings({
			config,
			runnerId: CLAUDE_CODE_AGENT_RUNNER_ID,
			...(this.resolveSettings ? { resolveSettings: this.resolveSettings } : {})
		});
		validateReasoningEffort(
			CLAUDE_CODE_AGENT_RUNNER_ID,
			settings.reasoningEffort,
			CLAUDE_REASONING_EFFORTS
		);
		validateCaptureSessions(CLAUDE_CODE_AGENT_RUNNER_ID, settings.captureSessions);
		validateDangerouslySkipPermissions(
			CLAUDE_CODE_AGENT_RUNNER_ID,
			settings.dangerouslySkipPermissions
		);
		return settings;
	}
}
