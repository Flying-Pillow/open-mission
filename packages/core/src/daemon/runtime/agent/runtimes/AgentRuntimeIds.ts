export const COPILOT_CLI_AGENT_RUNNER_ID = 'copilot-cli';
export const PI_AGENT_RUNNER_ID = 'pi';

export const DEFAULT_AGENT_RUNNER_ID = COPILOT_CLI_AGENT_RUNNER_ID;

export function isSupportedAgentRunner(runnerId: string | undefined): runnerId is string {
	return runnerId === COPILOT_CLI_AGENT_RUNNER_ID || runnerId === PI_AGENT_RUNNER_ID;
}