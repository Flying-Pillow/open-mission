import { describe, expect, it } from 'vitest';
import { deriveAgentExecutionInteractionCapabilities } from '../protocol/AgentExecutionProtocolTypes.js';
import { deriveAgentExecutionProtocolOwner } from '../protocol/AgentExecutionProtocolDescriptor.js';
import { AgentExecution } from '../AgentExecution.js';
import { AgentExecutionContract, createAgentExecutionDataChangedEvent } from '../AgentExecutionContract.js';
import { AgentExecutionObservationPolicy } from '../policy/AgentExecutionObservationPolicy.js';
import { AgentExecutionSchema, AgentExecutionProtocolDescriptorSchema } from '../AgentExecutionSchema.js';
import type { AgentExecutionType } from '../AgentExecutionSchema.js';
import type { AgentExecutionProcess } from '../protocol/AgentExecutionProtocolTypes.js';
import type { AgentExecutionJournalRecordType } from '../journal/AgentExecutionJournalSchema.js';

describe('AgentExecution', () => {
    it('uses canonical Entity id as the class identity', () => {
        const data = createAgentExecutionData();
        const execution = new AgentExecution(data);

        expect(execution.id).toBe(data.id);
        expect(execution.agentExecutionId).toBe(data.agentExecutionId);
    });

    it('materializes terminal identity through terminalHandle only', () => {
        const data = AgentExecution.cloneData(createAgentExecutionData({
            terminalHandle: {
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(data).toMatchObject({
            id: 'agent_execution:mission-1/AgentExecution-1',
            ownerId: 'mission-1',
            agentExecutionId: 'AgentExecution-1',
            transportId: 'terminal',
            interactionCapabilities: {
                mode: 'pty-terminal',
                canSendTerminalInput: true,
                canSendStructuredPrompt: false,
                canSendStructuredCommand: false
            },
            terminalHandle: {
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            }
        });
        expect(data.supportedMessages.map((message) => message.type)).toEqual([
            'interrupt',
            'checkpoint',
            'nudge'
        ]);
        expect('terminalName' in data).toBe(false);
        expect('terminalPaneId' in data).toBe(false);
    });

    it('derives agent-message capabilities for non-terminals that accept semantic structured follow-up input', () => {
        const snapshot: AgentExecutionProcess = {
            agentId: 'codex',
            agentExecutionId: 'AgentExecution-2',
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-2',
                stageId: 'implementation'
            },
            workingDirectory: '/repo',
            taskId: 'task-2',
            missionId: 'mission-1',
            stageId: 'implementation',
            status: 'running',
            attention: 'awaiting-operator',
            progress: {
                state: 'waiting-input',
                updatedAt: '2026-05-04T00:00:00.000Z'
            },
            waitingForInput: true,
            acceptsPrompts: true,
            acceptedCommands: ['resume', 'checkpoint'],
            interactionPosture: 'structured-headless',
            interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
                status: 'running',
                acceptsPrompts: true,
                acceptedCommands: ['resume', 'checkpoint']
            }),
            reference: {
                agentId: 'codex',
                agentExecutionId: 'AgentExecution-2'
            },
            startedAt: '2026-05-04T00:00:00.000Z',
            updatedAt: '2026-05-04T00:00:00.000Z'
        };

        const state = AgentExecution.createDataFromExecutionUpdate({
            execution: snapshot,
            adapterLabel: 'Codex'
        });

        expect(state.interactionCapabilities).toEqual({
            mode: 'agent-message',
            canSendTerminalInput: false,
            canSendStructuredPrompt: true,
            canSendStructuredCommand: true
        });
        expect(state.supportedMessages.map((message) => message.type)).toEqual([
            'checkpoint',
            'resume',
            'model'
        ]);
    });

    it('uses the provided adapter label when materializing live runtime data', () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess(), {
            adapterLabel: 'Copilot CLI'
        }).toData();

        expect(data.adapterLabel).toBe('Copilot CLI');
    });

    it('treats initializing progress as idle bootstrap activity instead of planning work', () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess({
            status: 'starting',
            attention: 'none',
            progress: {
                state: 'initializing',
                summary: 'Session initialized and waiting for the first task.',
                updatedAt: '2026-05-04T00:00:00.000Z'
            }
        })).toData();

        expect(data).toMatchObject({
            lifecycleState: 'starting',
            attention: 'none',
            activityState: 'idle',
            liveActivity: {
                progress: {
                    summary: 'Session initialized and waiting for the first task.'
                }
            }
        });
        expect(data.timeline.currentActivity).toBeUndefined();
    });

    it('surfaces awaiting-agent-response after an operator prompt until the agent replies', async () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess(), {
            adapterLabel: 'Copilot CLI'
        });

        await execution.submitPrompt({
            source: 'operator',
            text: 'Please continue with the next slice.'
        });

        execution.setAwaitingResponseToMessageId('message-1');

        expect(execution.toData()).toMatchObject({
            activityState: 'awaiting-agent-response',
            timeline: {
                currentActivity: {
                    activity: 'awaiting-agent-response'
                }
            }
        });

        execution.emitEvent({
            type: 'execution.message',
            channel: 'agent',
            text: 'I am continuing now.',
            execution: execution.getExecution()
        });

        execution.setAwaitingResponseToMessageId(null);

        expect(execution.toData()).toMatchObject({
            activityState: 'executing',
            timeline: {
                currentActivity: {
                    activity: 'executing'
                }
            }
        });
    });

    it('treats a replayed input request as structured follow-up input even when lifecycle stays running', async () => {
        const execution = new AgentExecution(AgentExecutionSchema.parse({
            id: 'agent_execution:mission-1/AgentExecution-1',
            ownerId: 'mission-1',
            agentExecutionId: 'AgentExecution-1',
            agentId: 'codex',
            process: createAgentExecutionProcess({
                agentExecutionId: 'AgentExecution-1',
                acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
                acceptsPrompts: true,
                transport: undefined,
                interactionPosture: 'structured-headless',
                interactionCapabilities: {
                    mode: 'agent-message',
                    canSendTerminalInput: false,
                    canSendStructuredPrompt: true,
                    canSendStructuredCommand: true
                },
                reference: {
                    agentId: 'codex',
                    agentExecutionId: 'AgentExecution-1'
                }
            }),
            adapterLabel: 'Codex',
            lifecycleState: 'running',
            currentInputRequestId: 'observation-1',
            interactionCapabilities: {
                mode: 'agent-message',
                canSendTerminalInput: false,
                canSendStructuredPrompt: true,
                canSendStructuredCommand: true
            },
            context: { artifacts: [], instructions: [] },
            supportedMessages: [],
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            createdAt: '2026-05-09T00:00:00.000Z',
            lastUpdatedAt: '2026-05-09T00:00:00.000Z',
            timeline: { timelineItems: [] }
        }));

        const hydrated = AgentExecution.applyDerivedInteractionState(execution.toData());

        expect(hydrated.interactionCapabilities).toEqual({
            mode: 'agent-message',
            canSendTerminalInput: false,
            canSendStructuredPrompt: true,
            canSendStructuredCommand: true
        });
        expect(hydrated.supportedMessages.map((message: { type: string }) => message.type)).toEqual([
            'interrupt',
            'checkpoint',
            'nudge',
            'resume',
            'model'
        ]);
    });

    it('rejects duplicate top-level terminal identity in AgentExecution data', () => {
        const data = AgentExecution.cloneData(createAgentExecutionData({
            terminalHandle: {
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(() => AgentExecutionSchema.parse({
            ...data,
            terminalName: 'mission-agent-execution'
        })).toThrow();
    });

    it('materializes selected signal transport state', () => {
        const data = AgentExecution.cloneData(createAgentExecutionData({
            transportState: {
                selected: 'mcp-tool',
                degraded: false
            }
        }));
        expect(data.transportState).toEqual({
            selected: 'mcp-tool',
            degraded: false
        });
        expect(AgentExecutionSchema.parse({
            ...data,
            transportState: {
                selected: 'mcp-tool'
            }
        }).transportState).toEqual({
            selected: 'mcp-tool',
            degraded: false
        });
    });

    it('treats a live task AgentExecution as incompatible when the requested agent changes', async () => {
        await expect(AgentExecution.isCompatibleForLaunch({
            AgentExecution: createAgentExecutionData({ agentId: 'copilot-cli' }),
            request: {
                agentId: 'codex',
                taskId: 'task-1',
                workingDirectory: '/repo',
                prompt: 'Continue.'
            },
            resolveLiveAgentExecution: async () => createAgentExecutionProcess({
                agentId: 'copilot-cli',
                taskId: 'task-1',
                workingDirectory: '/repo'
            })
        })).resolves.toBe(false);
    });

    it('keeps a live task AgentExecution compatible when task, agent, and working directory match', async () => {
        await expect(AgentExecution.isCompatibleForLaunch({
            AgentExecution: createAgentExecutionData({ agentId: 'codex' }),
            request: {
                agentId: 'codex',
                taskId: 'task-1',
                workingDirectory: '/repo',
                prompt: 'Continue.'
            },
            resolveLiveAgentExecution: async () => createAgentExecutionProcess({
                agentId: 'codex',
                taskId: 'task-1',
                workingDirectory: '/repo'
            })
        })).resolves.toBe(true);
    });

    it('advertises concrete AgentExecution contract events only', () => {
        expect(Object.keys(AgentExecutionContract.events ?? {})).toEqual(['data.changed', 'terminal']);
    });

    it('derives owner-addressed protocol metadata from AgentExecutionScope', () => {
        expect(deriveAgentExecutionProtocolOwner({
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'implementation/01-build',
            stageId: 'implementation'
        })).toEqual({
            entity: 'Task',
            entityId: 'implementation/01-build',
            markerPrefix: '@task::'
        });

        expect(deriveAgentExecutionProtocolOwner({
            kind: 'repository',
            repositoryRootPath: '/repo/mission'
        })).toEqual({
            entity: 'Repository',
            entityId: '/repo/mission',
            markerPrefix: '@repository::'
        });
    });

    it('exposes the protocol descriptor as the source of truth for messages and signals', () => {
        const descriptor = AgentExecution.createProtocolDescriptorForExecution(createAgentExecutionProcess());

        expect(AgentExecutionProtocolDescriptorSchema.parse(descriptor)).toEqual(descriptor);
        expect(descriptor.owner).toEqual({
            entity: 'Task',
            entityId: 'task-2',
            markerPrefix: '@task::'
        });
        expect(descriptor.interactionPosture).toBe('structured-interactive');
        expect(descriptor.messages.map((message) => message.type)).toEqual([
            'read',
            'interrupt',
            'checkpoint',
            'nudge',
            'model'
        ]);
        expect(descriptor.messages.map((message) => message.portability)).toEqual([
            'mission-native',
            'cross-agent',
            'cross-agent',
            'cross-agent',
            'terminal-only'
        ]);
        expect(descriptor.messages.map((message) => message.icon)).toEqual([
            'lucide:file-search',
            'lucide:pause',
            'lucide:milestone',
            'lucide:message-circle-more',
            'lucide:brain-circuit'
        ]);
        expect(descriptor.messages.map((message) => message.tone)).toEqual([
            'neutral',
            'attention',
            'neutral',
            'progress',
            undefined
        ]);
        expect(descriptor.signals.map((signal) => signal.type)).toEqual([
            'progress',
            'status',
            'needs_input',
            'blocked',
            'ready_for_verification',
            'completed_claim',
            'failed_claim',
            'message'
        ]);
        expect(descriptor.signals.map((signal) => signal.icon)).toEqual([
            'lucide:activity',
            'lucide:circle-dot',
            'lucide:message-circle-question',
            'lucide:octagon-alert',
            'lucide:badge-check',
            'lucide:check-check',
            'lucide:circle-x',
            'lucide:message-square'
        ]);
        expect(descriptor.signals.map((signal) => signal.tone)).toEqual([
            'progress',
            'neutral',
            'attention',
            'danger',
            'success',
            'success',
            'danger',
            'neutral'
        ]);
        expect(new Set(descriptor.signals.flatMap((signal) => signal.deliveries))).toEqual(new Set(['stdout-marker', 'mcp-tool']));
        expect(descriptor.mcp).toEqual({
            serverName: 'open-mission-mcp',
            exposure: 'agent-execution-scoped',
            publicApi: false
        });
    });

    it('rejects singular Agent signal delivery descriptors', () => {
        expect(() => AgentExecutionProtocolDescriptorSchema.parse({
            version: 1,
            owner: {
                entity: 'Task',
                entityId: 'task-2',
                markerPrefix: '@task::'
            },
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-2'
            },
            messages: [],
            signals: [{
                type: 'progress',
                label: 'Progress',
                icon: 'lucide:activity',
                tone: 'progress',
                payloadSchemaKey: 'agent-signal.progress.v1',
                delivery: 'stdout-marker',
                policy: 'progress',
                outcomes: ['agent-execution-state']
            }]
        })).toThrow();
    });

    it('materializes protocol descriptors on live AgentExecution data', () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess()).toData();

        expect(data.protocolDescriptor?.owner).toEqual({
            entity: 'Task',
            entityId: 'task-2',
            markerPrefix: '@task::'
        });
        expect(data.protocolDescriptor?.interactionPosture).toBe('structured-interactive');
        expect(data.protocolDescriptor?.messages).toEqual(expect.arrayContaining(data.supportedMessages));
        expect(data.protocolDescriptor?.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'read',
                portability: 'mission-native'
            }),
            expect.objectContaining({
                type: 'model',
                portability: 'terminal-only'
            })
        ]));
    });

    it('resolves message shorthand through the AgentExecution remote query seam', async () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess()).toData();

        const result = await AgentExecution.resolveMessageShorthand({
            ownerId: data.ownerId,
            agentExecutionId: data.agentExecutionId,
            text: '/nudge check status'
        }, {
            surfacePath: '/repo',
            agentExecutionRegistry: {
                hasExecution: () => true,
                readExecution: () => data
            } as never
        });

        expect(result).toMatchObject({
            kind: 'runtime-message',
            commandId: 'agentExecution.sendRuntimeMessage',
            input: {
                type: 'nudge',
                reason: 'check status'
            }
        });
    });

    it('invokes semantic operations through the AgentExecution remote mutation seam', async () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess()).toData();
        const invocations: unknown[] = [];

        const result = await AgentExecution.invokeSemanticOperation({
            ownerId: data.ownerId,
            agentExecutionId: data.agentExecutionId,
            name: 'read_artifact',
            input: {
                path: 'docs/architecture/agent-interaction-structured-first-spec.md'
            }
        }, {
            surfacePath: '/repo',
            agentExecutionRegistry: {
                hasExecution: () => true,
                readExecution: () => data,
                invokeSemanticOperation: async (input: unknown) => {
                    invocations.push(input);
                    return {
                        operationName: 'read_artifact',
                        agentExecutionId: data.agentExecutionId,
                        eventId: 'event-1',
                        path: 'docs/architecture/agent-interaction-structured-first-spec.md',
                        content: '# Spec',
                        factType: 'artifact-read'
                    };
                }
            } as never
        });

        expect(invocations).toEqual([{
            agentExecutionId: data.agentExecutionId,
            name: 'read_artifact',
            input: {
                path: 'docs/architecture/agent-interaction-structured-first-spec.md'
            }
        }]);
        expect(result).toMatchObject({
            operationName: 'read_artifact',
            factType: 'artifact-read',
            content: '# Spec'
        });
    });

    it('routes commands through the owner-agnostic AgentExecutionRegistry only', async () => {
        const data = createAgentExecutionData();
        const commands: unknown[] = [];
        const execution = new AgentExecution(data);

        await execution.command({
            ownerId: data.ownerId,
            agentExecutionId: data.agentExecutionId,
            commandId: 'agentExecution.cancel',
            input: { reason: 'operator cancelled' }
        }, {
            surfacePath: '/repo',
            agentExecutionRegistry: {
                hasExecution: () => true,
                readExecution: () => data,
                commandExecution: async (agentExecutionId: string, command: unknown) => {
                    commands.push({ agentExecutionId, command });
                    return data;
                }
            } as never
        });

        expect(commands).toEqual([{
            agentExecutionId: data.agentExecutionId,
            command: {
                commandId: 'agentExecution.cancel',
                input: { reason: 'operator cancelled' }
            }
        }]);
    });

    it('does not fall back to Mission when a registry execution is missing', async () => {
        const data = createAgentExecutionData();
        const execution = new AgentExecution(data);

        await expect(execution.command({
            ownerId: data.ownerId,
            agentExecutionId: data.agentExecutionId,
            commandId: 'agentExecution.cancel'
        }, {
            surfacePath: '/repo',
            agentExecutionRegistry: {
                hasExecution: () => false
            } as never
        })).rejects.toThrow(`AgentExecution '${data.agentExecutionId}' is not registered for owner '${data.ownerId}'.`);
    });

    it('materializes accepted AgentExecution signals as timeline items', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const events: string[] = [];
        execution.onDidEvent((event) => events.push(event.type));
        const observation = {
            observationId: 'observation-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'needs_input' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                question: 'Which setup profile should I use?',
                choices: [{ kind: 'fixed' as const, label: 'Default', value: 'default' }]
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'signal payload',
            observedAt: '2026-05-04T00:01:00.000Z'
        };
        const policy = new AgentExecutionObservationPolicy();
        const decision = policy.evaluate({ execution: execution.getExecution(), observation });

        if (decision.action === 'reject') {
            throw new Error(decision.reason);
        }
        const snapshot = execution.applySignalObservation(observation, decision);

        expect(execution.toData().timeline.timelineItems).toEqual([
            expect.objectContaining({
                id: 'observation-1',
                primitive: 'attention.input-request',
                payload: expect.objectContaining({
                    title: 'Needs input',
                    text: 'Which setup profile should I use?',
                    choices: [{ kind: 'fixed', label: 'Default', value: 'default' }]
                })
            })
        ]);
        expect(snapshot?.status).toBe('running');
        expect(snapshot?.attention).toBe('awaiting-operator');
        expect(snapshot?.waitingForInput).toBe(true);
        expect(events).toContain('execution.updated');
    });

    it('carries artifact references into projected signal timeline items', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const observation = {
            observationId: 'observation-progress-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'progress' as const,
                summary: 'Editing the implementation file.',
                artifacts: [{
                    artifactId: 'artifact-1',
                    path: 'apps/web/src/app.css',
                    activity: 'edit' as const
                }],
                source: 'agent-signal' as const,
                confidence: 'medium' as const
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'signal payload',
            observedAt: '2026-05-04T00:02:00.000Z'
        };
        const policy = new AgentExecutionObservationPolicy();
        const decision = policy.evaluate({ execution: execution.getExecution(), observation });

        if (decision.action === 'reject') {
            throw new Error(decision.reason);
        }

        execution.applySignalObservation(observation, decision);

        expect(execution.toData().timeline.timelineItems).toEqual([
            expect.objectContaining({
                id: 'observation-progress-1',
                primitive: 'activity.progress',
                payload: expect.objectContaining({
                    artifactId: 'artifact-1',
                    path: 'apps/web/src/app.css',
                    artifacts: [expect.objectContaining({
                        artifactId: 'artifact-1',
                        path: 'apps/web/src/app.css',
                        activity: 'edit'
                    })]
                })
            })
        ]);
    });

    it('keeps artifact-bearing agent messages in the live timeline timeline', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const observation = {
            observationId: 'observation-message-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'message' as const,
                channel: 'agent' as const,
                text: 'Re-read the workflow artifacts so their attachments are reported back visibly.',
                artifacts: [{
                    path: '.mission/workflow/workflow.json',
                    label: 'Workflow definition',
                    activity: 'read' as const
                }],
                source: 'agent-signal' as const,
                confidence: 'medium' as const
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'signal payload',
            observedAt: '2026-05-04T00:03:00.000Z'
        };
        const policy = new AgentExecutionObservationPolicy();
        const decision = policy.evaluate({ execution: execution.getExecution(), observation });

        if (decision.action === 'reject') {
            throw new Error(decision.reason);
        }

        execution.applySignalObservation(observation, decision);

        expect(execution.toData().timeline.timelineItems).toEqual([
            expect.objectContaining({
                id: 'observation-message-1',
                primitive: 'conversation.agent-message',
                payload: expect.objectContaining({
                    title: 'Investigated artifact',
                    text: 'Re-read the workflow artifacts so their attachments are reported back visibly.',
                    path: '.mission/workflow/workflow.json',
                    artifacts: [expect.objectContaining({
                        path: '.mission/workflow/workflow.json',
                        label: 'Workflow definition',
                        activity: 'read'
                    })]
                })
            })
        ]);
    });

    it('materializes status signals as activity timeline items', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const observation = {
            observationId: 'observation-status-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'status' as const,
                phase: 'idle' as const,
                summary: 'Ready for the next structured prompt.',
                source: 'agent-signal' as const,
                confidence: 'medium' as const
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'status payload',
            observedAt: '2026-05-04T00:01:00.000Z'
        };
        const policy = new AgentExecutionObservationPolicy();
        const decision = policy.evaluate({ execution: execution.getExecution(), observation });

        if (decision.action === 'reject') {
            throw new Error(decision.reason);
        }
        execution.applySignalObservation(observation, decision);

        expect(execution.toData().timeline.timelineItems).toEqual([
            expect.objectContaining({
                id: 'observation-status-1',
                primitive: 'activity.status',
                payload: expect.objectContaining({
                    title: 'Idle',
                    text: 'Ready for the next structured prompt.'
                })
            })
        ]);
    });

    it('keeps the active input request after an idle status update', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const policy = new AgentExecutionObservationPolicy();
        const needsInputObservation = {
            observationId: 'observation-needs-input-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'needs_input' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                question: 'Which kind of task do you feel like doing next?',
                choices: [
                    { kind: 'fixed' as const, label: 'Build something', value: 'build-something' },
                    { kind: 'manual' as const, label: 'Something else', placeholder: 'Type your own answer' }
                ]
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'needs input payload',
            observedAt: '2026-05-04T00:01:00.000Z'
        };
        const needsInputDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: needsInputObservation
        });

        if (needsInputDecision.action === 'reject') {
            throw new Error(needsInputDecision.reason);
        }

        execution.applySignalObservation(needsInputObservation, needsInputDecision);

        const idleObservation = {
            observationId: 'observation-status-idle-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'status' as const,
                phase: 'idle' as const,
                summary: "Waiting for the user's choice or manual answer.",
                source: 'agent-signal' as const,
                confidence: 'medium' as const
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'idle status payload',
            observedAt: '2026-05-04T00:01:05.000Z'
        };
        const idleDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: idleObservation
        });

        if (idleDecision.action === 'reject') {
            throw new Error(idleDecision.reason);
        }

        execution.applySignalObservation(idleObservation, idleDecision);

        expect(execution.toData().timeline.currentAttention).toEqual(
            expect.objectContaining({
                state: 'awaiting-operator',
                primitive: 'attention.input-request',
                text: 'Which kind of task do you feel like doing next?',
                currentInputRequestId: 'observation-needs-input-1'
            })
        );
    });

    it('keeps the active input request after a progress update', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const policy = new AgentExecutionObservationPolicy();
        const needsInputObservation = {
            observationId: 'observation-needs-input-progress-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'needs_input' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                question: 'Which deepening opportunity would you like to explore?',
                choices: [
                    { kind: 'fixed' as const, label: 'Architecture', value: 'architecture' },
                    { kind: 'manual' as const, label: 'Something else', placeholder: 'Type your own answer' }
                ]
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'needs input payload',
            observedAt: '2026-05-04T00:03:00.000Z'
        };
        const needsInputDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: needsInputObservation
        });

        if (needsInputDecision.action === 'reject') {
            throw new Error(needsInputDecision.reason);
        }

        execution.applySignalObservation(needsInputObservation, needsInputDecision);

        const progressObservation = {
            observationId: 'observation-progress-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'progress' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                summary: 'Waiting for the operator to choose a deepening opportunity.'
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'progress payload',
            observedAt: '2026-05-04T00:03:05.000Z'
        };
        const progressDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: progressObservation
        });

        if (progressDecision.action === 'reject') {
            throw new Error(progressDecision.reason);
        }

        execution.applySignalObservation(progressObservation, progressDecision);

        expect(execution.toData().timeline.currentAttention).toEqual(
            expect.objectContaining({
                state: 'awaiting-operator',
                primitive: 'attention.input-request',
                text: 'Which deepening opportunity would you like to explore?',
                currentInputRequestId: 'observation-needs-input-progress-1'
            })
        );
    });

    it('keeps the active input request question when later attention items are appended', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const policy = new AgentExecutionObservationPolicy();
        const needsInputObservation = {
            observationId: 'observation-needs-input-2',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'needs_input' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                question: 'What should I focus on next?',
                choices: [
                    { kind: 'fixed' as const, label: 'Repository initialization', value: 'repo-init' },
                    { kind: 'fixed' as const, label: 'Mission task work', value: 'mission-task' },
                    { kind: 'manual' as const, label: 'Other', placeholder: 'Type your own answer' }
                ]
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'needs input payload',
            observedAt: '2026-05-04T00:02:00.000Z'
        };
        const needsInputDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: needsInputObservation
        });

        if (needsInputDecision.action === 'reject') {
            throw new Error(needsInputDecision.reason);
        }

        execution.applySignalObservation(needsInputObservation, needsInputDecision);

        const reviewObservation = {
            observationId: 'observation-review-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'ready_for_verification' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                summary: 'Ready for review.'
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'ready for verification',
            observedAt: '2026-05-04T00:02:30.000Z'
        };
        const reviewDecision = policy.evaluate({
            execution: execution.getExecution(),
            observation: reviewObservation
        });

        if (reviewDecision.action === 'reject') {
            throw new Error(reviewDecision.reason);
        }

        execution.applySignalObservation(reviewObservation, reviewDecision);

        expect(execution.toData().timeline.currentAttention).toEqual(
            expect.objectContaining({
                state: 'awaiting-operator',
                primitive: 'attention.input-request',
                title: 'Needs input',
                text: 'What should I focus on next?',
                currentInputRequestId: 'observation-needs-input-2',
                choices: [
                    { kind: 'fixed', label: 'Repository initialization', value: 'repo-init' },
                    { kind: 'fixed', label: 'Mission task work', value: 'mission-task' },
                    { kind: 'manual', label: 'Other', placeholder: 'Type your own answer' }
                ]
            })
        );
    });

    it('notifies data changes for record-only claims that append timeline items', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const dataChanges: AgentExecutionType[] = [];
        execution.onDidDataChange((data) => dataChanges.push(data));
        const observation = {
            observationId: 'observation-ready-1',
            agentExecutionId: 'AgentExecution-2',
            source: 'agent-signal' as const,
            signal: {
                type: 'ready_for_verification' as const,
                source: 'agent-signal' as const,
                confidence: 'medium' as const,
                summary: 'Setup files are ready.'
            },
            route: {
                origin: 'agent-signal' as const,
                address: {
                    agentExecutionId: 'AgentExecution-2',
                    scope: execution.getExecution().scope
                }
            },
            claimedAddress: {
                agentExecutionId: 'AgentExecution-2',
                scope: execution.getExecution().scope
            },
            rawText: 'signal payload',
            observedAt: '2026-05-04T00:01:00.000Z'
        };
        const policy = new AgentExecutionObservationPolicy();
        const decision = policy.evaluate({ execution: execution.getExecution(), observation });

        if (decision.action === 'reject') {
            throw new Error(decision.reason);
        }
        execution.applySignalObservation(observation, decision);

        expect(dataChanges).toHaveLength(1);
        expect(dataChanges.at(0)?.timeline.timelineItems).toEqual([
            expect.objectContaining({
                id: 'observation-ready-1',
                primitive: 'attention.verification-requested',
                payload: expect.objectContaining({
                    title: 'Ready for verification',
                    text: 'Setup files are ready.'
                })
            })
        ]);
    });

    it('creates AgentExecution data.changed events from canonical data', () => {
        const data = AgentExecution.createLive(createAgentExecutionProcess()).toData();
        const event = createAgentExecutionDataChangedEvent({ data });

        expect(event).toMatchObject({
            entityId: 'agent_execution:mission-1/AgentExecution-2',
            channel: 'agent_execution:mission-1/AgentExecution-2.data.changed',
            eventName: 'data.changed',
            type: 'agentExecution.data.changed',
            payload: {
                reference: {
                    entity: 'AgentExecution',
                    ownerId: 'mission-1',
                    agentExecutionId: 'AgentExecution-2'
                },
                execution: data
            }
        });
    });

    it('publishes appended journal records in canonical data changes', () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());
        const dataChanges: AgentExecutionType[] = [];
        execution.onDidDataChange((data) => dataChanges.push(data));

        execution.appendJournalRecord(createJournalRecord(), { notify: true });

        expect(dataChanges).toHaveLength(1);
        expect(dataChanges[0]?.journalRecords).toEqual([
            expect.objectContaining({ recordId: 'record-journal-1', type: 'turn.accepted' })
        ]);
    });

    it('materializes operator prompts as timeline items', async () => {
        const execution = AgentExecution.createLive(createAgentExecutionProcess());

        await execution.submitPrompt({
            source: 'operator',
            text: 'Use the default setup profile.'
        });

        expect(execution.toData().timeline.timelineItems).toEqual([
            expect.objectContaining({
                primitive: 'conversation.operator-message',
                payload: expect.objectContaining({
                    text: 'Use the default setup profile.'
                })
            })
        ]);
    });
});

function createAgentExecutionData(overrides: Partial<AgentExecutionType> = {}): AgentExecutionType {
    const data = {
        id: 'agent_execution:mission-1/AgentExecution-1',
        ownerId: 'mission-1',
        agentExecutionId: 'AgentExecution-1',
        agentId: 'copilot-cli',
        process: createAgentExecutionProcess({
            agentId: 'copilot-cli',
            agentExecutionId: 'AgentExecution-1',
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            taskId: 'task-1',
            missionId: 'mission-1',
            stageId: undefined
        }),
        adapterLabel: 'Copilot CLI',
        lifecycleState: 'running',
        createdAt: '2026-05-02T00:00:00.000Z',
        lastUpdatedAt: '2026-05-02T00:00:00.000Z',
        taskId: 'task-1',
        assignmentLabel: 'implementation/tasks/task-1.md',
        currentTurnTitle: 'Implement task',
        interactionCapabilities: {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false
        },
        supportedMessages: AgentExecution.createSupportedMessagesForCommands([
            'interrupt',
            'checkpoint',
            'nudge'
        ]),
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'task-1'
        },
        ...overrides
    };
    return AgentExecutionSchema.parse({
        ...data,
        context: data.context ?? AgentExecution.createContext(data),
        timeline: data.timeline ?? { timelineItems: [] }
    });
}

function createAgentExecutionProcess(overrides: Partial<AgentExecutionProcess> = {}): AgentExecutionProcess {
    return {
        agentId: 'codex',
        agentExecutionId: 'AgentExecution-2',
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'task-2',
            stageId: 'implementation'
        },
        workingDirectory: '/repo',
        taskId: 'task-2',
        missionId: 'mission-1',
        stageId: 'implementation',
        status: 'running',
        attention: 'autonomous',
        progress: {
            state: 'working',
            updatedAt: '2026-05-04T00:00:00.000Z'
        },
        waitingForInput: false,
        acceptsPrompts: true,
        acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
        interactionPosture: 'structured-interactive',
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: 'running',
            transport: {
                kind: 'terminal',
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            },
            acceptsPrompts: true,
            acceptedCommands: ['interrupt', 'checkpoint', 'nudge']
        }),
        transport: {
            kind: 'terminal',
            terminalName: 'mission-agent-execution',
            terminalPaneId: 'terminal_1'
        },
        reference: {
            agentId: 'codex',
            agentExecutionId: 'AgentExecution-2',
            transport: {
                kind: 'terminal',
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            }
        },
        startedAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
        ...overrides
    };
}

function createJournalRecord(): AgentExecutionJournalRecordType {
    return {
        recordId: 'record-journal-1',
        sequence: 1,
        type: 'turn.accepted',
        family: 'turn.accepted',
        entrySemantics: 'event',
        authority: 'operator',
        assertionLevel: 'authoritative',
        replayClass: 'replay-critical',
        origin: 'operator',
        schemaVersion: 1,
        agentExecutionId: 'AgentExecution-2',
        executionContext: {
            owner: {
                entityType: 'Task',
                entityId: 'task-2'
            },
            mission: {
                missionId: 'mission-1',
                taskId: 'task-2',
                stageId: 'implementation'
            },
            runtime: {
                agentAdapter: 'codex'
            },
            daemon: {
                runtimeVersion: 'test-runtime',
                protocolVersion: '2026-05-10'
            }
        },
        occurredAt: '2026-05-04T00:00:01.000Z',
        messageId: 'message-1',
        source: 'operator',
        messageType: 'prompt',
        payload: {
            text: 'Continue with the next slice.'
        },
        mutatesContext: false
    };
}
