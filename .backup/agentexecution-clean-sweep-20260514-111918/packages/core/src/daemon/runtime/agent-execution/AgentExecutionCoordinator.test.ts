import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../entities/Agent/Agent.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentAdapter } from './adapter/AgentAdapter.js';
import { AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS, AgentExecutionCoordinator } from './AgentExecutionCoordinator.js';
import type { AgentExecutionSemanticOperationInvocationType } from './AgentExecutionSemanticOperations.js';
import { OpenMissionMcpServer } from './mcp/OpenMissionMcpServer.js';
import { createMemoryAgentExecutionJournalWriter } from './testing/createMemoryAgentExecutionJournalWriter.js';

describe('AgentExecutionCoordinator', () => {
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
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const executor = new AgentExecutionCoordinator({
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
                if (execution.toData().timeline.timelineItems.length > 1 || AgentExecution.isTerminalFinalStatus(execution.getExecution().status)) {
                    resolve(execution.toData());
                    return;
                }
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for direct stdout marker.')), 2_000);
                const dataSubscription = execution.onDidDataChange((nextData) => {
                    if (nextData.timeline.timelineItems.length > 1) {
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
                timeline: {
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

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'agent-observation',
                    source: 'daemon',
                    signal: expect.objectContaining({
                        type: 'message',
                        channel: 'agent',
                        text: 'I will inspect the repository.',
                        source: 'daemon-authoritative',
                        confidence: 'authoritative'
                    })
                })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('publishes adapter-scoped supported message descriptors in the launch protocol', async () => {
        const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-executor-descriptors-'));
        temporaryDirectories.add(workingDirectory);
        const adapter = new AgentAdapter({
            id: 'descriptor-agent',
            command: process.execPath,
            displayName: 'Descriptor Agent',
            supportedMessages: [{
                type: 'compact-provider-context',
                label: 'Compact Provider Context',
                delivery: 'best-effort',
                mutatesContext: false,
                portability: 'adapter-scoped',
                adapterId: 'descriptor-agent'
            }],
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', 'process.exit(0)']
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutionCoordinator({
            agentRegistry: new AgentRegistry({ agents: [agent] })
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: workingDirectory
                },
                workingDirectory,
                requestedAdapterId: 'descriptor-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            });

            expect(execution.toData().protocolDescriptor?.messages).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'compact-provider-context',
                    portability: 'adapter-scoped',
                    adapterId: 'descriptor-agent'
                })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('keeps mcp-delivered terminal output out of agent chat messages', async () => {
        const mcpServer = new OpenMissionMcpServer({
            agentExecutionRegistry: {
                routeTransportObservation: (input) => ({
                    status: 'accepted',
                    agentExecutionId: input.agentExecutionId,
                    eventId: 'test-event',
                    observationId: input.observation.observationId
                })
            }
        });
        await mcpServer.start();
        const adapter = new AgentAdapter({
            id: 'mcp-prose-agent',
            command: process.execPath,
            displayName: 'MCP Prose Agent',
            transportCapabilities: {
                supported: ['mcp-tool'],
                preferred: {
                    print: 'mcp-tool',
                    interactive: 'mcp-tool'
                },
                provisioning: {
                    requiresRuntimeConfig: false,
                    supportsStdioBridge: false,
                    supportsAgentExecutionScopedTools: true
                }
            },
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "setTimeout(() => { console.log('Help manage Flying-Pillow/connect-four for Mission.'); console.log('◎ Thinking (Esc to cancel)'); console.log('I will outline the safe paths from the current dirty main state.'); console.log('Inspect git worktree state (shell)'); }, 25); setTimeout(() => process.exit(0), 60);"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const executor = new AgentExecutionCoordinator({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter,
            openMissionMcpServer: mcpServer
        });

        try {
            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: process.cwd()
                },
                workingDirectory: process.cwd(),
                requestedAdapterId: 'mcp-prose-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'operator',
                    text: 'Summarize the brief.'
                }
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for MCP terminal execution to finish.')), 2_000);
                const eventSubscription = execution.onDidEvent((event) => {
                    if (event.type === 'execution.completed' || event.type === 'execution.failed' || event.type === 'execution.terminated') {
                        clearTimeout(timeout);
                        eventSubscription.dispose();
                        resolve();
                    }
                });
            });

            expect(execution.toData()).toMatchObject({
                transportState: {
                    selected: 'mcp-tool',
                    degraded: false
                }
            });
            expect(execution.toData().timeline.timelineItems).not.toEqual(expect.arrayContaining([
                expect.objectContaining({
                    primitive: 'conversation.agent-message'
                })
            ]));

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).not.toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'agent-observation',
                    signal: expect.objectContaining({
                        type: 'message',
                        channel: 'agent'
                    })
                })
            ]));
            expect(journalRecords).not.toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'agent-execution-fact',
                    fact: expect.objectContaining({ type: 'artifact-read' })
                })
            ]));
        } finally {
            executor.dispose();
            await mcpServer.stop();
        }
    });

    it('emits an authoritative idle status after process output goes quiet', async () => {
        vi.useFakeTimers();
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'quiet-agent',
            command: process.execPath,
            displayName: 'Quiet Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 60_000)']
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutionCoordinator({
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
                requestedAdapterId: 'quiet-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            });

            const idleEvent = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for idle status.')), 5_000);
                const subscription = execution.onDidEvent((event) => {
                    if (event.type === 'execution.updated' && event.execution.progress.state === 'idle') {
                        clearTimeout(timeout);
                        subscription.dispose();
                        resolve(event);
                    }
                });
            });

            await vi.advanceTimersByTimeAsync(AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS + 1);
            await idleEvent;

            expect(execution.getExecution()).toMatchObject({
                status: 'running',
                attention: 'awaiting-operator',
                waitingForInput: false,
                progress: {
                    state: 'idle',
                    summary: 'No further agent output observed; execution is idle.'
                }
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'agent-observation',
                    source: 'daemon',
                    signal: expect.objectContaining({
                        type: 'status',
                        phase: 'idle',
                        summary: 'No further agent output observed; execution is idle.',
                        source: 'daemon-authoritative',
                        confidence: 'authoritative'
                    })
                })
            ]));

            await executor.terminateExecution(execution.agentExecutionId, 'test cleanup');
        } finally {
            vi.useRealTimers();
            executor.dispose();
        }
    });

    it('appends a journal.header before launch-turn records', async () => {
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
        const executor = new AgentExecutionCoordinator({
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
            expect(journalRecords?.[0]).toMatchObject({
                type: 'journal.header',
                sequence: 0,
                agentExecutionId: execution.agentExecutionId,
                agentId: 'header-agent',
                workingDirectory: process.cwd(),
                executionContext: {
                    scope: {
                        entityType: 'Repository',
                        entityId: process.cwd()
                    },
                    repository: {
                        repositoryId: process.cwd()
                    }
                }
            });
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'turn.accepted', source: 'system', messageType: 'prompt' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'attempted', transport: 'agent-message' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'delivered', transport: 'agent-message' }),
                expect.objectContaining({
                    type: 'state.changed',
                    lifecycle: 'running',
                    attention: 'autonomous',
                    activity: 'awaiting-agent-response',
                    awaitingResponseToMessageId: expect.any(String)
                })
            ]));
            expect(execution.toData()).toMatchObject({
                activityState: 'awaiting-agent-response',
                awaitingResponseToMessageId: expect.any(String),
                timeline: {
                    currentActivity: {
                        activity: 'awaiting-agent-response'
                    }
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
        const executor = new AgentExecutionCoordinator({
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
        const executor = new AgentExecutionCoordinator({
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
        const executor = new AgentExecutionCoordinator({
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
                expect.objectContaining({ type: 'turn.accepted', source: 'operator', messageType: 'prompt' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'attempted', transport: 'pty-terminal' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'delivered', transport: 'pty-terminal' }),
                expect.objectContaining({
                    type: 'state.changed',
                    lifecycle: 'running',
                    attention: 'autonomous',
                    activity: 'awaiting-agent-response',
                    awaitingResponseToMessageId: expect.any(String)
                })
            ]));
            expect(execution.toData()).toMatchObject({
                activityState: 'awaiting-agent-response',
                awaitingResponseToMessageId: expect.any(String)
            });

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
        const executor = new AgentExecutionCoordinator({
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
                expect.objectContaining({ type: 'turn.accepted', source: 'operator', messageType: 'command.interrupt' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'attempted', transport: 'agent-message' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'delivered', transport: 'agent-message' })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('promotes turn-starting commands to awaiting-agent-response', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'resume-agent',
            command: '/bin/sh',
            displayName: 'Resume Agent',
            createLaunchPlan: () => ({
                mode: 'interactive',
                command: '/bin/sh',
                args: ['-lc', 'cat >/dev/null']
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutionCoordinator({
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
                requestedAdapterId: 'resume-agent',
                resume: { mode: 'new' }
            });

            await executor.submitCommand(execution.agentExecutionId, {
                type: 'resume',
                reason: 'Continue with the repository turn.'
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'turn.accepted', source: 'operator', messageType: 'command.resume' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'attempted', transport: 'pty-terminal' }),
                expect.objectContaining({ type: 'turn.delivery', status: 'delivered', transport: 'pty-terminal' }),
                expect.objectContaining({
                    type: 'state.changed',
                    lifecycle: 'running',
                    attention: 'autonomous',
                    activity: 'awaiting-agent-response',
                    awaitingResponseToMessageId: expect.any(String)
                })
            ]));
            expect(execution.toData()).toMatchObject({
                activityState: 'awaiting-agent-response',
                awaitingResponseToMessageId: expect.any(String),
                timeline: {
                    currentActivity: {
                        activity: 'awaiting-agent-response'
                    }
                }
            });

            await executor.terminateExecution(execution.agentExecutionId, 'test cleanup');
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
        const executor = new AgentExecutionCoordinator({
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
                        origin: 'agent-signal',
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
                        source: 'agent-signal',
                        confidence: 'medium',
                        summary: 'Inspecting repository.'
                    }
                }
            });

            expect(ack.status).toBe('promoted');

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'agent-observation', observationId: 'observation-1', source: 'pty' }),
                expect.objectContaining({ type: 'decision.recorded', observationId: 'observation-1', action: 'update-state' }),
                expect.objectContaining({ type: 'state.changed', lifecycle: 'running', attention: 'autonomous', activity: 'executing' }),
                expect.objectContaining({ type: 'activity.updated', progress: expect.objectContaining({ summary: 'Inspecting repository.' }) })
            ]));
        } finally {
            executor.dispose();
        }
    });

    it('records provider tool-call observations without promoting them into Agent execution facts', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'provider-tool-agent',
            command: process.execPath,
            displayName: 'Provider Tool Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ready')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutionCoordinator({
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
                requestedAdapterId: 'provider-tool-agent',
                resume: { mode: 'new' }
            });

            const ack = await executor.routeTransportObservation({
                agentExecutionId: execution.agentExecutionId,
                observation: {
                    observationId: 'provider-observation-1',
                    observedAt: '2026-05-09T00:00:10.000Z',
                    route: {
                        origin: 'provider-output',
                        address: {
                            agentExecutionId: execution.agentExecutionId,
                            scope: {
                                kind: 'repository',
                                repositoryRootPath: process.cwd()
                            }
                        }
                    },
                    signal: {
                        type: 'diagnostic',
                        code: 'tool-call',
                        summary: "Provider invoked tool 'read_file'.",
                        payload: {
                            toolName: 'read_file',
                            args: 'missions/1-initial-setup/BRIEF.md'
                        },
                        source: 'provider-structured',
                        confidence: 'medium'
                    }
                }
            });

            expect(ack.status).toBe('recorded-only');

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${process.cwd()}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'agent-observation', observationId: 'provider-observation-1', source: 'provider-output' }),
                expect.objectContaining({
                    type: 'transport-evidence',
                    evidenceType: 'provider-payload',
                    origin: 'provider-output',
                    payload: expect.objectContaining({
                        observationId: 'provider-observation-1',
                        signalType: 'diagnostic',
                        signalCode: 'tool-call'
                    })
                })
            ]));
            expect(journalRecords.some((record) => record.type === 'agent-execution-fact')).toBe(false);
        } finally {
            executor.dispose();
        }
    });

    it('records Mission-owned artifact reads as authoritative Agent execution facts', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const adapter = new AgentAdapter({
            id: 'artifact-reader-agent',
            command: process.execPath,
            displayName: 'Artifact Reader Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ready')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        const executor = new AgentExecutionCoordinator({
            agentRegistry: new AgentRegistry({ agents: [agent] }),
            journalWriter
        });

        try {
            const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-executor-artifact-read-'));
            await fs.mkdir(path.join(repositoryRoot, 'missions', '1-initial-setup'), { recursive: true });
            await fs.writeFile(path.join(repositoryRoot, 'missions', '1-initial-setup', 'BRIEF.md'), '# Brief\n', 'utf8');

            const execution = await executor.startExecution({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: repositoryRoot
                },
                workingDirectory: repositoryRoot,
                requestedAdapterId: 'artifact-reader-agent',
                resume: { mode: 'new' }
            });

            const result = await executor.invokeSemanticOperation({
                agentExecutionId: execution.agentExecutionId,
                name: 'read_artifact',
                input: {
                    path: 'missions/1-initial-setup/BRIEF.md'
                }
            } satisfies AgentExecutionSemanticOperationInvocationType);

            expect(result).toMatchObject({
                operationName: 'read_artifact',
                agentExecutionId: execution.agentExecutionId,
                path: 'missions/1-initial-setup/BRIEF.md',
                content: '# Brief\n',
                factType: 'artifact-read'
            });

            const journalRecords = recordsByJournalId.get(`agent-execution-journal:Repository/${repositoryRoot}/${execution.agentExecutionId}`) ?? [];
            expect(journalRecords).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: 'agent-execution-fact',
                    factType: 'artifact-read',
                    path: 'missions/1-initial-setup/BRIEF.md',
                    payload: expect.objectContaining({ operationName: 'read_artifact' })
                })
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
        const executor = new AgentExecutionCoordinator({
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
                        origin: 'agent-signal',
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
                        source: 'agent-signal',
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
                expect.objectContaining({ type: 'agent-observation', observationId: 'observation-needs-input-1', source: 'pty' }),
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

    it('caps retained process output for usage parsing on high-volume streams', async () => {
        let retainedContentLength = 0;
        const line = 'x'.repeat(1024);
        const adapter = new AgentAdapter({
            id: 'stream-agent',
            command: process.execPath,
            displayName: 'Stream Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', `for (let index = 0; index < 400; index += 1) console.log(${JSON.stringify(line + '-')} + index);`]
            }),
            parseAgentExecutionUsageContent: (content) => {
                retainedContentLength = content.length;
                return undefined;
            }
        });
        const agent = await Agent.fromAdapter(adapter);
        const { journalWriter } = createMemoryAgentExecutionJournalWriter();
        const executor = new AgentExecutionCoordinator({
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
                requestedAdapterId: 'stream-agent',
                resume: { mode: 'new' },
                initialPrompt: {
                    source: 'system',
                    text: 'Start.'
                }
            });

            await new Promise<void>((resolve, reject) => {
                if (AgentExecution.isTerminalFinalStatus(execution.getExecution().status)) {
                    resolve();
                    return;
                }
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for stream agent completion.')), 2_000);
                const subscription = execution.onDidEvent((event) => {
                    if (event.type === 'execution.completed' || event.type === 'execution.failed' || event.type === 'execution.terminated') {
                        clearTimeout(timeout);
                        subscription.dispose();
                        resolve();
                    }
                });
            });

            expect(retainedContentLength).toBeGreaterThan(0);
            expect(retainedContentLength).toBeLessThanOrEqual(262_144);
        } finally {
            executor.dispose();
        }
    });
});
