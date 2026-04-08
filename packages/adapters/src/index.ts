import type { AgentRunner } from '../../core/build/runtime/AgentRunner.js';
import {
	COPILOT_CLI_AGENT_RUNTIME_ID,
	DEFAULT_AGENT_RUNTIME_ID,
	normalizeLegacyAgentRuntimeId
} from '../../core/build/lib/agentRuntimes.js';
import { CopilotSdkAgentRunner } from '../../core/build/adapters/CopilotSdkAgentRunner.js';
import { CopilotCliAgentRunner } from '../../core/build/adapters/CopilotCliAgentRunner.js';
import { TerminalAgentTransport } from '../../core/build/adapters/TerminalAgentTransport.js';
import { readMissionDaemonSettings } from '../../core/build/lib/daemonConfig.js';
import path from 'node:path';
import os from 'node:os';

export { CopilotSdkAgentRunner };
export { CopilotCliAgentRunner };
export { TerminalAgentTransport };

type ConfiguredAgentSettings = {
	agentRuntime?: string;
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

function getTerminalTransportOptions(
	_controlRoot: string,
	runtimeId: string,
	displayName: string,
	logLine?: (line: string) => void
) {
	const overriddenCommand = process.env['MISSION_TERMINAL_AGENT_COMMAND']?.trim();
	const terminalBinary = process.env['MISSION_TERMINAL_BINARY']?.trim()
		|| process.env['MISSION_ZELLIJ_BINARY']?.trim()
		|| undefined;
	if (overriddenCommand) {
		return {
			runtimeId,
			displayName,
			command: 'sh',
			args: ['-lc', overriddenCommand],
			...(terminalBinary ? { terminalBinary } : {}),
			...(logLine ? { logLine } : {})
		};
	}
	return {
		runtimeId,
		displayName,
		command: resolveDefaultCopilotCliPath(),
		args: ['--experimental'],
		...(terminalBinary ? { terminalBinary } : {}),
		...(logLine ? { logLine } : {})
	};
}

export async function createConfiguredAgentRunners(options: {
	controlRoot: string;
	logLine?: (line: string) => void;
}): Promise<AgentRunner[]> {
	const daemonSettings = readMissionDaemonSettings(options.controlRoot) as ConfiguredAgentSettings | undefined;
	const configuredRuntime = normalizeLegacyAgentRuntimeId(daemonSettings?.agentRuntime) ?? DEFAULT_AGENT_RUNTIME_ID;
	const sdkRunner = new CopilotSdkAgentRunner(
		getCopilotRunnerOptions(daemonSettings, options.controlRoot, options.logLine)
	);
	const cliRunner = new CopilotCliAgentRunner(
		getTerminalTransportOptions(options.controlRoot, COPILOT_CLI_AGENT_RUNTIME_ID, 'Copilot CLI', options.logLine)
	);
	const runnersById = new Map<string, AgentRunner>([
		[sdkRunner.id, sdkRunner],
		[cliRunner.id, cliRunner]
	]);
	const selectedRunner = runnersById.get(configuredRuntime);

	if (!selectedRunner) {
		throw new Error(`Mission adapters do not support agent runtime '${configuredRuntime}'.`);
	}

	const orderedRunners = [selectedRunner];
	for (const runner of runnersById.values()) {
		if (runner.id !== selectedRunner.id) {
			orderedRunners.push(runner);
		}
	}
	return orderedRunners;
}
