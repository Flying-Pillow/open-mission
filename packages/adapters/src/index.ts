import type { AgentRunner } from '../../core/build/runtime/AgentRunner.js';
import { CopilotAgentRunner } from '../../core/build/adapters/CopilotAgentRunner.js';
import { readMissionDaemonSettings } from '../../core/build/lib/daemonConfig.js';
import path from 'node:path';

export { CopilotAgentRunner };

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

export async function createConfiguredAgentRunners(options: {
	controlRoot: string;
	logLine?: (line: string) => void;
}): Promise<AgentRunner[]> {
	const daemonSettings = readMissionDaemonSettings(options.controlRoot) as ConfiguredAgentSettings | undefined;
	const agentRunner = daemonSettings?.agentRunner?.trim();

	if (!agentRunner) {
		return [];
	}

	if (agentRunner !== 'copilot') {
		throw new Error(`Mission adapters do not support agent runner '${agentRunner}'.`);
	}

	return [
		new CopilotAgentRunner(
			getCopilotRunnerOptions(daemonSettings, options.controlRoot, options.logLine)
		)
	];
}
