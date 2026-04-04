import {
	type MissionAgentRuntime
} from '../../core/build/daemon/MissionAgentRuntime.js';
import { CopilotAgentRuntime } from '../../core/build/adapters/CopilotAgentRuntime.js';
import { readMissionRepoSettings } from '../../core/build/lib/repoConfig.js';
import path from 'node:path';

export { CopilotAgentRuntime };

type ConfiguredAgentSettings = {
	agentRunner?: string;
	defaultModel?: string;
	skillsPath?: string;
};

export async function createConfiguredMissionRuntimes(options: {
	repoRoot: string;
	logLine?: (line: string) => void;
}): Promise<MissionAgentRuntime[]> {
	const repoSettings = readMissionRepoSettings(options.repoRoot) as ConfiguredAgentSettings | undefined;
	const agentRunner = repoSettings?.agentRunner?.trim();

	if (!agentRunner) {
		return [];
	}

	if (agentRunner !== 'copilot') {
		throw new Error(`Mission adapters do not support agent runner '${agentRunner}'.`);
	}

	return [
		new CopilotAgentRuntime({
			...(repoSettings?.defaultModel ? { defaultModel: repoSettings.defaultModel } : {}),
			...(repoSettings?.skillsPath
				? {
					skillDirectories: [
						path.isAbsolute(repoSettings.skillsPath)
							? repoSettings.skillsPath
							: path.join(options.repoRoot, repoSettings.skillsPath)
					]
				}
				: {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		})
	];
}
