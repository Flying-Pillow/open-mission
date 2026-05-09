import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../entities/Agent/Agent.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentAdapter } from './AgentAdapter.js';
import { AgentExecutor } from './AgentExecutor.js';
import { createMemoryAgentExecutionJournalWriter } from './testing/createMemoryAgentExecutionJournalWriter.js';

describe('AgentExecutor', () => {
    const temporaryDirectories = new Set<string>();

    afterEach(async () => {
        await Promise.all([...temporaryDirectories].map(async (directory) => {
            await fs.rm(directory, { recursive: true, force: true });
            temporaryDirectories.delete(directory);
        }));
    });

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
        const { journalWriter } = createMemoryAgentExecutionJournalWriter();
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
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
                if (execution.toData().projection.timelineItems.length > 1 || AgentExecution.isTerminalFinalStatus(execution.getSnapshot().status)) {
                    resolve(execution.toData());
                    return;
                }
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for direct stdout marker.')), 2_000);
                const dataSubscription = execution.onDidDataChange((nextData) => {
                    if (nextData.projection.timelineItems.length > 1) {
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
                projection: {
                    timelineItems: [
                        {
                            primitive: 'conversation.agent-message',
                            payload: {
                                text: 'I will inspect the repository.'
                            }
                        },
                        {
                            primitive: 'activity.progress',
                            payload: {
                                text: 'Inspecting repository.'
                            }
                        }
                    ]
                }
            });
        } finally {
            executor.dispose();
        }
    });

    it('appends a journal.header before runtime start', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'header-agent',
            command: process.execPath,
            displayName: 'Header Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('header-ready')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'header-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`);
            expect(journalRecords).toHaveLength(1);
            expect(journalRecords?.[0]).toMatchObject({
                type: 'journal.header',
                sequence: 0,
                agentExecutionId: execution.agentExecutionId,
                agentId: 'header-agent',
                workingDirectory: process.cwd(),
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                }
            });
        } finally {
            executor.dispose();
        }
    });

    it('fails launch before runtime start when ensureJournal fails', async () => {
        const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-executor-ensure-'));
        temporaryDirectories.add(runtimeDirectory);
        const sideEffectPath = path.join(runtimeDirectory, 'started.txt');
        const { journalWriter } = createMemoryAgentExecutionJournalWriter({
            ensureError: new Error('ensure failed')
        });
        const adapter = new AgentAdapter({
            id: 'ensure-fail-agent',
            command: process.execPath,
            displayName: 'Ensure Fail Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(sideEffectPath)}, 'started')`]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            await expect(executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: runtimeDirectory
                },
                workingDirectory: runtimeDirectory,
                requestedAdapterId: 'ensure-fail-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            })).rejects.toThrow('ensure failed');
            await expect(fs.stat(sideEffectPath)).rejects.toThrow();
        } finally {
            executor.dispose();
        }
    });

    it('fails launch before runtime start when header append fails', async () => {
        const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-executor-append-'));
        temporaryDirectories.add(runtimeDirectory);
        const sideEffectPath = path.join(runtimeDirectory, 'started.txt');
        const { journalWriter } = createMemoryAgentExecutionJournalWriter({
            appendError: new Error('append failed')
        });
        const adapter = new AgentAdapter({
            id: 'append-fail-agent',
            command: process.execPath,
            displayName: 'Append Fail Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(sideEffectPath)}, 'started')`]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            await expect(executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: runtimeDirectory
                },
                workingDirectory: runtimeDirectory,
                requestedAdapterId: 'append-fail-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            })).rejects.toThrow('append failed');
            await expect(fs.stat(sideEffectPath)).rejects.toThrow();
        } finally {
            executor.dispose();
        }
    });

    it('records submitted prompts as accepted and delivered journal messages', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'prompt-agent',
            command: '/bin/sh',
            displayName: 'Prompt Agent',
            createLaunchPlan: () => ({
                mode: 'interactive',
                command: '/bin/sh',
                args: ['-lc', 'cat >/dev/null']
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'prompt-agent',
                resume: { mode: 'new' }
            });

            await executor.submitPrompt(execution.agentExecutionId, {
                source: 'operator',
                text: 'Explain the current failure.'
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'message.accepted', source: 'operator', messageType: 'prompt' }),
                expect.objectContaining({ type: 'message.delivery', status: 'attempted', transport: 'pty-terminal' }),
                expect.objectContaining({ type: 'message.delivery', status: 'delivered', transport: 'pty-terminal' })
            ]));

            await executor.terminateExecution(execution.agentExecutionId, 'test cleanup');
        } finally {
            executor.dispose();
        }
    });

    it('records submitted commands as accepted and delivered journal messages', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'command-agent',
            command: process.execPath,
            displayName: 'Command Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 60_000)']
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'command-agent',
                resume: { mode: 'new' }
            });

            await executor.submitCommand(execution.agentExecutionId, {
                type: 'interrupt',
                reason: 'Stop for review.'
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'message.accepted', source: 'operator', messageType: 'command.interrupt' }),
                expect.objectContaining({ type: 'message.delivery', status: 'attempted', transport: 'agent-message' }),
                expect.objectContaining({ type: 'message.delivery', status: 'delivered', transport: 'agent-message' })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('records observations, decisions, and state transitions in the interaction journal', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'observation-agent',
            command: process.execPath,
            displayName: 'Observation Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ready')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'observation-agent',
                resume: { mode: 'new' }
            });

            const ack = await executor.routeTransportObservation({
                agentExecutionId: execution.agentExecutionId,
                observation: {
                    observationId: 'observation-1',
                    observedAt: '2026-05-09T00:00:10.000Z',
                    route: {
                        origin: 'agent-declared-signal',
                        address: {
                            agentExecutionId: execution.agentExecutionId,
                            scope: {
                                kind: 'repository',
                                repositoryRootPath: process.cwd()
                            }
                        }
                    },
                    claimedAddress: {
                        agentExecutionId: execution.agentExecutionId,
                        scope: {
                            kind: 'repository',
                            repositoryRootPath: process.cwd()
                        }
                    },
                    rawText: '@repository::{...}',
                    signal: {
                        type: 'progress',
                        source: 'agent-declared',
                        confidence: 'medium',
                        summary: 'Inspecting repository.'
                    }
                }
            });

            expect(ack.status).toBe('promoted');

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'observation.recorded', observationId: 'observation-1', source: 'pty' }),
                expect.objectContaining({ type: 'decision.recorded', observationId: 'observation-1', action: 'update-state' }),
                expect.objectContaining({ type: 'state.changed', lifecycle: 'running', attention: 'autonomous', currentInputRequestId: null }),
                expect.objectContaining({ type: 'activity.updated', progress: expect.objectContaining({ summary: 'Inspecting repository.' }) })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('records needs-input as running semantic state with an input request id', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'needs-input-agent',
            command: process.execPath,
            displayName: 'Needs Input Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ready')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutor({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'needs-input-agent',
                resume: { mode: 'new' }
            });

            const ack = await executor.routeTransportObservation({
                agentExecutionId: execution.agentExecutionId,
                observation: {
                    observationId: 'observation-needs-input-1',
                    observedAt: '2026-05-09T00:00:20.000Z',
                    route: {
                        origin: 'agent-declared-signal',
                        address: {
                            agentExecutionId: execution.agentExecutionId,
                            scope: {
                                kind: 'repository',
                                repositoryRootPath: process.cwd()
                            }
                        }
                    },
                    claimedAddress: {
                        agentExecutionId: execution.agentExecutionId,
                        scope: {
                            kind: 'repository',
                            repositoryRootPath: process.cwd()
                        }
                    },
                    rawText: '@repository::{...}',
                    signal: {
                        type: 'needs_input',
                        source: 'agent-declared',
                        confidence: 'medium',
                        question: 'Should I run the verification slice?',
                        choices: [
                            { kind: 'fixed', label: 'Yes', value: 'yes' },
                            { kind: 'fixed', label: 'No', value: 'no' }
                        ]
                    }
                }
            });

            expect(ack.status).toBe('promoted');

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'observation.recorded', observationId: 'observation-needs-input-1', source: 'pty' }),
                expect.objectContaining({ type: 'decision.recorded', observationId: 'observation-needs-input-1', action: 'update-state' }),
                expect.objectContaining({
                    type: 'state.changed',
                    lifecycle: 'running',
                    attention: 'awaiting-operator',
                    activity: 'communicating',
                    currentInputRequestId: 'observation-needs-input-1'
                }),
                expect.objectContaining({
                    type: 'activity.updated',
                    activity: 'communicating',
                    progress: expect.objectContaining({ summary: 'Should I run the verification slice?' })
                })
            ]));
        } finally {
            executor.dispose();
        }
    });
});
