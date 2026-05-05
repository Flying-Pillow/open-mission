import { ClaudeCodeAgentRunner } from './ClaudeCodeAgentRunner.js';
import { CopilotCliAgentRunner } from './CopilotCliAgentRunner.js';
import { CodexAgentRunner } from './CodexAgentRunner.js';
import { OpenCodeAgentRunner } from './OpenCodeAgentRunner.js';
import { PiAgentRunner } from './PiAgentRunner.js';
import {
	CLAUDE_CODE_AGENT_RUNNER_ID,
	CODEX_AGENT_RUNNER_ID,
	OPENCODE_AGENT_RUNNER_ID
} from './AgentRuntimeIds.js';
import { Repository } from '../../../../entities/Repository/Repository.js';
import { createDefaultRepositorySettings } from '../../../../entities/Repository/RepositorySchema.js';
import type { AgentRunner } from '../AgentRunner.js';
import { AgentSessionMcpAccessProvisioner } from '../mcp/AgentSessionMcpAccessProvisioner.js';
import type { MissionMcpSignalServer } from '../mcp/MissionMcpSignalServer.js';
import type { MissionAgentRunnerSettingsResolver } from './MissionAgentPtyRunner.js';

export async function createConfiguredAgentRunners(options: {
	repositoryRootPath: string;
	terminalSessionName?: string;
	logLine?: (line: string) => void;
	mcpSignalServer?: MissionMcpSignalServer;
}): Promise<AgentRunner[]> {
	const settings = Repository.readSettingsDocument(options.repositoryRootPath) ?? createDefaultRepositorySettings();
	const resolveProviderSettings = createProviderSettingsResolver({
		defaultModel: settings.defaultModel,
		defaultReasoningEffort: settings.defaultReasoningEffort
	});
	const mcpProvisioner = options.mcpSignalServer
		? new AgentSessionMcpAccessProvisioner({ signalServer: options.mcpSignalServer })
		: undefined;

	return [
		new CopilotCliAgentRunner({
			command: process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
			...(mcpProvisioner ? { mcpProvisioner } : {}),
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
		new ClaudeCodeAgentRunner({
			resolveSettings: resolveProviderSettings,
			...(mcpProvisioner ? { mcpProvisioner } : {}),
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
		new PiAgentRunner({
			resolveSettings: resolveProviderSettings,
			...(mcpProvisioner ? { mcpProvisioner } : {}),
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
		new CodexAgentRunner({
			resolveSettings: resolveProviderSettings,
			...(mcpProvisioner ? { mcpProvisioner } : {}),
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
		new OpenCodeAgentRunner({
			resolveSettings: resolveProviderSettings,
			...(mcpProvisioner ? { mcpProvisioner } : {}),
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		})
	];
}

function createProviderSettingsResolver(
	defaults: {
		defaultModel: string | undefined;
		defaultReasoningEffort: string | undefined;
	}
): MissionAgentRunnerSettingsResolver<typeof CLAUDE_CODE_AGENT_RUNNER_ID | typeof CODEX_AGENT_RUNNER_ID | typeof OPENCODE_AGENT_RUNNER_ID | 'pi'> {
	return (config, runnerId) => {
		const defaultReasoningEffort = supportsDefaultReasoningEffort(runnerId)
			? defaults.defaultReasoningEffort?.trim()
			: undefined;
		const settings = {
			model: readStringMetadata(config, 'model') ?? defaults.defaultModel?.trim() ?? '',
			launchMode: 'interactive' as const,
			runtimeEnv: process.env
		};
		const reasoningEffort = readStringMetadata(config, 'reasoningEffort') ?? defaultReasoningEffort;
		const dangerouslySkipPermissions = readBooleanMetadata(config, 'dangerouslySkipPermissions');
		const resumeSession = readStringMetadata(config, 'resumeSession');
		const captureSessions = readBooleanMetadata(config, 'captureSessions');
		return {
			...settings,
			...(reasoningEffort ? { reasoningEffort } : {}),
			...(dangerouslySkipPermissions !== undefined ? { dangerouslySkipPermissions } : {}),
			...(resumeSession ? { resumeSession } : {}),
			...(captureSessions !== undefined ? { captureSessions } : {})
		};
	};
}

function supportsDefaultReasoningEffort(
	runnerId: typeof CLAUDE_CODE_AGENT_RUNNER_ID | typeof CODEX_AGENT_RUNNER_ID | typeof OPENCODE_AGENT_RUNNER_ID | 'pi'
): boolean {
	return runnerId === CLAUDE_CODE_AGENT_RUNNER_ID || runnerId === CODEX_AGENT_RUNNER_ID;
}

function readStringMetadata(
	config: Parameters<
		MissionAgentRunnerSettingsResolver<typeof CLAUDE_CODE_AGENT_RUNNER_ID | typeof CODEX_AGENT_RUNNER_ID | typeof OPENCODE_AGENT_RUNNER_ID | 'pi'>
	>[0],
	key: string
): string | undefined {
	const value = config.metadata?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBooleanMetadata(
	config: Parameters<
		MissionAgentRunnerSettingsResolver<typeof CLAUDE_CODE_AGENT_RUNNER_ID | typeof CODEX_AGENT_RUNNER_ID | typeof OPENCODE_AGENT_RUNNER_ID | 'pi'>
	>[0],
	key: string
): boolean | undefined {
	const value = config.metadata?.[key];
	return typeof value === 'boolean' ? value : undefined;
}
