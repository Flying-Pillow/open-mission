export const COPILOT_CLI_AGENT_RUNNER_ID = 'copilot-cli';
export const COPILOT_SDK_AGENT_RUNNER_ID = 'pi';

export const DEFAULT_AGENT_RUNNER_ID = COPILOT_CLI_AGENT_RUNNER_ID;

export function normalizeLegacyAgentRunnerId(runnerId: string | undefined): string | undefined {
	const normalized = runnerId?.trim();
	if (!normalized) {
		return undefined;
	}
	if (normalized === 'copilot') {
		return COPILOT_CLI_AGENT_RUNNER_ID;
	}
	return normalized;
}

export function getDefaultTransportForRunner(runnerId: string): 'direct' | 'terminal' {
	return runnerId === COPILOT_SDK_AGENT_RUNNER_ID ? 'direct' : 'terminal';
}

export function isSupportedAgentRunner(runnerId: string | undefined): runnerId is string {
	return runnerId === COPILOT_CLI_AGENT_RUNNER_ID || runnerId === COPILOT_SDK_AGENT_RUNNER_ID;
}

export function isSupportedRunnerTransportPair(runnerId: string, transportId: string): boolean {
	if (runnerId === COPILOT_CLI_AGENT_RUNNER_ID) {
		return transportId === 'terminal';
	}
	if (runnerId === COPILOT_SDK_AGENT_RUNNER_ID) {
		return transportId === 'direct';
	}
	return false;
}