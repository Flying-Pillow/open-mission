import {
	type MissionAgentRuntime
} from '../../core/build/daemon/MissionAgentRuntime.js';
import { CopilotAgentRuntime } from '../../core/build/adapters/CopilotAgentRuntime.js';
import { readMissionDaemonSettings } from '../../core/build/lib/daemonConfig.js';
import path from 'node:path';

export { CopilotAgentRuntime };

type ConfiguredAgentSettings = {
	agentRunner?: string;
	defaultModel?: string;
	skillsPath?: string;
};

export async function createConfiguredMissionRuntimes(options: {
	controlRoot: string;
	logLine?: (line: string) => void;
}): Promise<MissionAgentRuntime[]> {
	const daemonSettings = readMissionDaemonSettings(options.controlRoot) as ConfiguredAgentSettings | undefined;
	const agentRunner = daemonSettings?.agentRunner?.trim();

	if (!agentRunner) {
		return [];
	}

	if (agentRunner !== 'copilot') {
		throw new Error(`Mission adapters do not support agent runner '${agentRunner}'.`);
	}

	return [
		new CopilotAgentRuntime({
			...(daemonSettings?.defaultModel ? { defaultModel: daemonSettings.defaultModel } : {}),
			...(daemonSettings?.skillsPath
				? {
					skillDirectories: [
						path.isAbsolute(daemonSettings.skillsPath)
							? daemonSettings.skillsPath
							: path.join(options.controlRoot, daemonSettings.skillsPath)
					]
				}
				: {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		})
	];
}
