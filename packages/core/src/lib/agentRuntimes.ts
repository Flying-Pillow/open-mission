export const COPILOT_CLI_AGENT_RUNTIME_ID = 'copilot-cli';
export const COPILOT_SDK_AGENT_RUNTIME_ID = 'copilot-sdk';

export const DEFAULT_AGENT_RUNTIME_ID = COPILOT_CLI_AGENT_RUNTIME_ID;

export function normalizeLegacyAgentRuntimeId(runtimeId: string | undefined): string | undefined {
	const normalized = runtimeId?.trim();
	if (!normalized) {
		return undefined;
	}
	if (normalized === 'copilot') {
		return COPILOT_CLI_AGENT_RUNTIME_ID;
	}
	return normalized;
}

export function getDefaultTransportForRuntime(runtimeId: string): 'direct' | 'terminal' {
	return runtimeId === COPILOT_SDK_AGENT_RUNTIME_ID ? 'direct' : 'terminal';
}

export function isSupportedAgentRuntime(runtimeId: string | undefined): runtimeId is string {
	return runtimeId === COPILOT_CLI_AGENT_RUNTIME_ID || runtimeId === COPILOT_SDK_AGENT_RUNTIME_ID;
}

export function isSupportedRuntimeTransportPair(runtimeId: string, transportId: string): boolean {
	if (runtimeId === COPILOT_CLI_AGENT_RUNTIME_ID) {
		return transportId === 'terminal';
	}
	if (runtimeId === COPILOT_SDK_AGENT_RUNTIME_ID) {
		return transportId === 'direct';
	}
	return false;
}