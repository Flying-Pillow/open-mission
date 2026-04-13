import { describe, expect, it } from 'vitest';
import {
	COPILOT_CLI_AGENT_RUNNER_ID,
	DEFAULT_AGENT_RUNNER_ID,
	PI_AGENT_RUNNER_ID,
	isSupportedAgentRunner
} from './AgentRuntimeIds.js';

describe('AgentRuntimeIds', () => {
	it('exposes stable runtime IDs and default selection', () => {
		expect(COPILOT_CLI_AGENT_RUNNER_ID).toBe('copilot-cli');
		expect(PI_AGENT_RUNNER_ID).toBe('pi');
		expect(DEFAULT_AGENT_RUNNER_ID).toBe(COPILOT_CLI_AGENT_RUNNER_ID);
	});

	it('validates supported runtime IDs', () => {
		expect(isSupportedAgentRunner('copilot-cli')).toBe(true);
		expect(isSupportedAgentRunner('pi')).toBe(true);
		expect(isSupportedAgentRunner('unknown')).toBe(false);
		expect(isSupportedAgentRunner(undefined)).toBe(false);
	});
});
