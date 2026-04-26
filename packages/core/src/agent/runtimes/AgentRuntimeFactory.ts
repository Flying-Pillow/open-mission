import { CopilotCliAgentRunner } from './CopilotCliAgentRunner.js';
import { PiAgentRunner } from './PiAgentRunner.js';
import { readRepositorySettingsDocument } from '../../lib/daemonConfig.js';
import type { AgentRunner } from '../AgentRunner.js';

export async function createConfiguredAgentRunners(options: {
	controlRoot: string;
	terminalSessionName?: string;
	logLine?: (line: string) => void;
}): Promise<AgentRunner[]> {
	readRepositorySettingsDocument(options.controlRoot);

	return [
		new CopilotCliAgentRunner({
			command: process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
			...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		}),
			new PiAgentRunner({
				...(options.terminalSessionName?.trim() ? { sharedSessionName: options.terminalSessionName.trim() } : {}),
			...(options.logLine ? { logLine: options.logLine } : {})
		})
	];
}