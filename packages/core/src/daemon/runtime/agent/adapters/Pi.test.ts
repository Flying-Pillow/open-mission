import { describe, expect, it } from 'vitest';
import type { AgentLaunchConfig } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { createAgentAdapter } from '../AgentAdapter.js';
import { createPi } from './Pi.js';

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

describe('Pi', () => {
    it('maps Mission reasoning effort to Pi thinking and supports print mode', () => {
        const adapter = createAgentAdapter(createPi({ command: 'pi' }), {
            resolveSettings: () => ({
                model: 'gpt-5.4',
                reasoningEffort: 'high',
                launchMode: 'print',
                runtimeEnv: process.env
            })
        });

        const plan = adapter.createLaunchPlan(createLaunchConfig());

        expect(plan.mode).toBe('print');
        expect(plan.command).toBe('pi');
        expect(plan.args).toContain('--print');
        expect(plan.args).toContain('--model');
        expect(plan.args).toContain('gpt-5.4');
        expect(plan.args).toContain('--thinking');
        expect(plan.args).toContain('high');
        expect(plan.args).toContain('Implement the task.');
    });
});