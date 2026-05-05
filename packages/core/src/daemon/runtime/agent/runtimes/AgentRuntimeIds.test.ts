import { describe, expect, it } from 'vitest';
import {
	CLAUDE_CODE_AGENT_RUNNER_ID,
	COPILOT_CLI_AGENT_RUNNER_ID,
	CODEX_AGENT_RUNNER_ID,
	DEFAULT_AGENT_RUNNER_ID,
	OPENCODE_AGENT_RUNNER_ID,
	PI_AGENT_RUNNER_ID,
	SUPPORTED_AGENT_RUNNER_IDS,
	isSupportedAgentRunner
} from './AgentRuntimeIds.js';
import { MissionAgentRunnerSchema } from '../../../../entities/Mission/MissionSchema.js';
import {
	WorkflowGeneratedTaskDefinitionSchema,
	WorkflowRuntimeSettingsSchema
} from '../../../../workflow/WorkflowSchema.js';

describe('AgentRuntimeIds', () => {
	it('exposes stable runtime IDs and default selection', () => {
		expect(COPILOT_CLI_AGENT_RUNNER_ID).toBe('copilot-cli');
		expect(CLAUDE_CODE_AGENT_RUNNER_ID).toBe('claude-code');
		expect(PI_AGENT_RUNNER_ID).toBe('pi');
		expect(CODEX_AGENT_RUNNER_ID).toBe('codex');
		expect(OPENCODE_AGENT_RUNNER_ID).toBe('opencode');
		expect(SUPPORTED_AGENT_RUNNER_IDS).toEqual([
			COPILOT_CLI_AGENT_RUNNER_ID,
			CLAUDE_CODE_AGENT_RUNNER_ID,
			PI_AGENT_RUNNER_ID,
			CODEX_AGENT_RUNNER_ID,
			OPENCODE_AGENT_RUNNER_ID
		]);
		expect(DEFAULT_AGENT_RUNNER_ID).toBe(COPILOT_CLI_AGENT_RUNNER_ID);
	});

	it('validates supported runtime IDs', () => {
		expect(isSupportedAgentRunner('copilot-cli')).toBe(true);
		expect(isSupportedAgentRunner('claude-code')).toBe(true);
		expect(isSupportedAgentRunner('pi')).toBe(true);
		expect(isSupportedAgentRunner('codex')).toBe(true);
		expect(isSupportedAgentRunner('opencode')).toBe(true);
		expect(isSupportedAgentRunner('unknown')).toBe(false);
		expect(isSupportedAgentRunner(undefined)).toBe(false);
	});

	it('accepts supported runner IDs in mission and workflow schemas', () => {
		for (const runnerId of SUPPORTED_AGENT_RUNNER_IDS) {
			expect(MissionAgentRunnerSchema.parse(runnerId)).toBe(runnerId);
			expect(
				WorkflowRuntimeSettingsSchema.parse({
					agentRunner: runnerId,
					defaultModel: 'gpt-5-codex',
					defaultReasoningEffort: 'high'
				}).agentRunner
			).toBe(runnerId);
			expect(
				WorkflowGeneratedTaskDefinitionSchema.parse({
					taskId: 'implementation/test-runner-id',
					title: 'Runner id task',
					instruction: 'Validate legal workflow task runner ids.',
					model: 'gpt-5-codex',
					reasoningEffort: 'high',
					dependsOn: [],
					agentRunner: runnerId
				}).agentRunner
			).toBe(runnerId);
		}
	});

	it('rejects unsupported workflow reasoning effort values', () => {
		expect(
			WorkflowRuntimeSettingsSchema.safeParse({
				agentRunner: DEFAULT_AGENT_RUNNER_ID,
				defaultReasoningEffort: 'extreme'
			}).success
		).toBe(false);
		expect(
			WorkflowGeneratedTaskDefinitionSchema.safeParse({
				taskId: 'implementation/test-reasoning-effort',
				title: 'Reasoning effort task',
				instruction: 'Reject unsupported task reasoning effort values.',
				reasoningEffort: 'extreme',
				dependsOn: []
			}).success
		).toBe(false);
	});
});
