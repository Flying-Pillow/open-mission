import { describe, expect, it } from 'vitest';
import type { AgentLaunchConfig } from '../../../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import { createAgentAdapter } from '../AgentAdapter.js';
import { createOpenCode } from './OpenCode.js';

function createLaunchConfig(): AgentLaunchConfig {
    return {
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'task-1',
            stageId: 'implementation'
        },
        workingDirectory: '/tmp/work',
        task: {
            taskId: 'task-1',
            stageId: 'implementation',
            title: 'Implement the task',
            description: 'Implement the task',
            instruction: 'Implement the task.'
        },
        specification: {
            summary: 'Implement the task.',
            documents: []
        },
        resume: { mode: 'new' },
        initialPrompt: {
            source: 'engine',
            text: 'Implement the task.'
        }
    };
}

describe('OpenCode', () => {
    it('uses the interactive prompt flag surfaced by the CLI help', () => {
        const adapter = createAgentAdapter(createOpenCode({ command: 'opencode' }), {
            resolveSettings: () => ({
                model: 'openai/gpt-5.4',
                runtimeEnv: process.env
            })
        });

        const plan = adapter.createLaunchPlan(createLaunchConfig());

        expect(plan.mode).toBe('interactive');
        expect(plan.command).toBe('opencode');
        expect(plan.args).toContain('--model');
        expect(plan.args).toContain('openai/gpt-5.4');
        expect(plan.args).toContain('--prompt');
        expect(plan.args).toContain('Implement the task.');
        expect(plan.args).not.toContain('-p');
    });

    it('uses the run subcommand for non-interactive print mode', () => {
        const adapter = createAgentAdapter(createOpenCode({ command: 'opencode' }), {
            resolveSettings: () => ({
                model: 'openai/gpt-5.4',
                launchMode: 'print',
                runtimeEnv: process.env
            })
        });

        const plan = adapter.createLaunchPlan(createLaunchConfig());

        expect(plan.mode).toBe('print');
        expect(plan.args.slice(0, 3)).toEqual(['run', '--format', 'json']);
        expect(plan.args).toContain('Implement the task.');
    });
});