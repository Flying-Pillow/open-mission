import type { AgentRunner } from '../../core/build/runtime/AgentRunner.js';
import { CopilotAgentRunner } from '../../core/build/adapters/CopilotAgentRunner.js';
import { TmuxAgentRunner } from '../../core/build/adapters/TmuxAgentRunner.js';
import { readMissionDaemonSettings } from '../../core/build/lib/daemonConfig.js';
import path from 'node:path';
import os from 'node:os';

export { CopilotAgentRunner };
export { TmuxAgentRunner };

type ConfiguredAgentSettings = {
	agentRunner?: string;
	defaultAgentMode?: 'interactive' | 'autonomous';
	defaultModel?: string;
	skillsPath?: string;
};

function getCopilotRunnerOptions(
	daemonSettings: ConfiguredAgentSettings | undefined,
	controlRoot: string,
	logLine?: (line: string) => void
) {
	return {
		...(daemonSettings?.defaultModel ? { defaultModel: daemonSettings.defaultModel } : {}),
		...(daemonSettings?.skillsPath
			? {
				skillDirectories: [
					path.isAbsolute(daemonSettings.skillsPath)
						? daemonSettings.skillsPath
						: path.join(controlRoot, daemonSettings.skillsPath)
				]
			}
			: {}),
		...(logLine ? { logLine } : {})
	};
}

function resolveDefaultCopilotCliPath(): string {
	const homeDirectory = os.homedir();
	if (!homeDirectory) {
		return 'copilot';
	}
	return path.join(
		homeDirectory,
		'.config',
		'Code',
		'User',
		'globalStorage',
		'github.copilot-chat',
		'copilotCli',
		'copilot'
	);
}

function getTmuxRunnerOptions(
	controlRoot: string,
	logLine?: (line: string) => void
) {
	const overriddenCommand = process.env['MISSION_TMUX_AGENT_COMMAND']?.trim();
	const tmuxBinary = process.env['MISSION_TMUX_BINARY']?.trim() || undefined;
	if (overriddenCommand) {
		return {
			command: 'sh',
			args: ['-lc', overriddenCommand],
			...(tmuxBinary ? { tmuxBinary } : {}),
			...(logLine ? { logLine } : {})
		};
	}
	return {
		command: resolveDefaultCopilotCliPath(),
		args: ['--add-dir', controlRoot],
		...(tmuxBinary ? { tmuxBinary } : {}),
		...(logLine ? { logLine } : {})
	};
}

export async function createConfiguredAgentRunners(options: {
	controlRoot: string;
	logLine?: (line: string) => void;
}): Promise<AgentRunner[]> {
	const daemonSettings = readMissionDaemonSettings(options.controlRoot) as ConfiguredAgentSettings | undefined;
	const agentRunner = daemonSettings?.agentRunner?.trim();

	if (!agentRunner) {
		return [];
	}

	if (agentRunner === 'copilot') {
		return [
			new CopilotAgentRunner(
				getCopilotRunnerOptions(daemonSettings, options.controlRoot, options.logLine)
			)
		];
	}

	if (agentRunner === 'tmux') {
		return [
			new TmuxAgentRunner(
				getTmuxRunnerOptions(options.controlRoot, options.logLine)
			)
		];
	}

	throw new Error(`Mission adapters do not support agent runner '${agentRunner}'.`);
}
