import { describe, expect, it } from 'vitest';
import { Agent } from '../../../entities/Agent/Agent.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentAdapter } from './AgentAdapter.js';
import { AgentExecutor } from './AgentExecutor.js';

describe('AgentExecutor', () => {
    it('parses strict markers from direct print-mode stdout', async () => {
        const adapter = new AgentAdapter({
            id: 'print-agent',
            command: process.execPath,
            displayName: 'Print Agent',
            createLaunchPlan: (config) => {
                const agentExecutionId = config.initialPrompt?.text.match(/agentExecutionId: ([^.\n]+)/)?.[1]?.trim() ?? 'missing';
                const script = `console.log('I will inspect the repository.'); console.log('@repository::' + JSON.stringify({ version: 1, agentExecutionId: ${JSON.stringify(agentExecutionId)}, eventId: 'event-1', signal: { type: 'progress', summary: 'Inspecting repository.' } }));`;
                return {
                    mode: 'print',
                    command: process.execPath,
                    args: ['-e', script]
                };
            }
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] })
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'print-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            });

            const data = await new Promise((resolve, reject) => {
                if (execution.toData().chatMessages.length > 1 || AgentExecution.isTerminalFinalStatus(execution.getSnapshot().status)) {
                    resolve(execution.toData());
                    return;
                }
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for direct stdout marker.')), 2_000);
                const dataSubscription = execution.onDidDataChange((nextData) => {
                    if (nextData.chatMessages.length > 1) {
                        clearTimeout(timeout);
                        dataSubscription.dispose();
                        eventSubscription.dispose();
                        resolve(nextData);
                    }
                });
                const eventSubscription = execution.onDidEvent((event) => {
                    if (event.type === 'execution.completed' || event.type === 'execution.failed' || event.type === 'execution.terminated') {
                        clearTimeout(timeout);
                        dataSubscription.dispose();
                        eventSubscription.dispose();
                        resolve(execution.toData());
                    }
                });
            });

            expect(data).toMatchObject({
                transportState: {
                    selected: 'stdout-marker',
                    degraded: false
                },
                chatMessages: [
                    {
                        role: 'agent',
                        kind: 'message',
                        text: 'I will inspect the repository.'
                    },
                    {
                        role: 'agent',
                        kind: 'progress',
                        text: 'Inspecting repository.'
                    }
                ]
            });
        } finally {
            executor.dispose();
        }
    });
});
