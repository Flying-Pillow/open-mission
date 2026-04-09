import path from 'node:path';
import { CopilotCliAgentRunner } from '../adapters/CopilotCliAgentRunner.js';
import { CopilotSdkAgentRunner } from '../adapters/CopilotSdkAgentRunner.js';
import {
	getDefaultMissionDaemonSettingsWithOverrides,
	readMissionDaemonSettings
} from '../lib/daemonConfig.js';
import type { AgentRunner } from '../runtime/AgentRunner.js';

export async function createConfiguredAgentRunners(options: {
	controlRoot: string;
	terminalSessionName?: string;
	logLine?: (line: string) => void;
}): Promise<AgentRunner[]> {
	const settings = getDefaultMissionDaemonSettingsWithOverrides(
		readMissionDaemonSettings(options.controlRoot) ?? {}
	);
	const skillDirectories = settings.skillsPath
		? [resolveControlPath(options.controlRoot, settings.skillsPath)]
		: [];

	return [
		new CopilotCliAgentRunner({
			command: process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
		new CopilotSdkAgentRunner({
			...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
			...(skillDirectories.length > 0 ? { skillDirectories } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		})
	];
}

function resolveControlPath(controlRoot: string, configuredPath: string): string {
	return path.isAbsolute(configuredPath)
		? configuredPath
		: path.join(controlRoot, configuredPath);
}