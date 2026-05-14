import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './AgentRegistry.js';
import { createDefaultRepositorySettings } from '../Repository/RepositorySchema.js';
import type { AgentLaunchConfig } from '../AgentExecution/AgentExecutionSchema.js';

function createLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
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
        },
        ...overrides
    };
}

describe('AgentRegistry', () => {
    it('preserves Pi adapter default print launch mode in configured registries', async () => {
        const settings = createDefaultRepositorySettings();
        settings.defaultModel = 'gpt-5.4';

        const registry = await AgentRegistry.createConfigured({
            repositoryRootPath: '/mission',
            settings
        });
        const plan = registry.requireAgentAdapter('pi').createLaunchPlan(createLaunchConfig());

        expect(plan.mode).toBe('print');
        expect(plan.args).toContain('--print');
    });

    it('allows launch metadata to override the adapter default launch mode', async () => {
        const settings = createDefaultRepositorySettings();
        settings.defaultModel = 'gpt-5.4';

        const registry = await AgentRegistry.createConfigured({
            repositoryRootPath: '/mission',
            settings
        });
        const plan = registry.requireAgentAdapter('pi').createLaunchPlan(createLaunchConfig({
            metadata: {
                launchMode: 'interactive'
            }
        }));

        expect(plan.mode).toBe('interactive');
        expect(plan.args).not.toContain('--print');
    });
});