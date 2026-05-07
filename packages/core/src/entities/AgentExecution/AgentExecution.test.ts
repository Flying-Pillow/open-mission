import { describe, expect, it } from 'vitest';
import { deriveAgentExecutionInteractionCapabilities, type AgentExecutionSnapshot } from './AgentExecutionProtocolTypes.js';
import { deriveAgentExecutionProtocolOwner } from './AgentExecutionProtocolDescriptor.js';
import { AgentExecution } from './AgentExecution.js';
import { AgentExecutionContract } from './AgentExecutionContract.js';
import { AgentExecutionDataSchema, AgentExecutionProtocolDescriptorSchema } from './AgentExecutionSchema.js';
import type { AgentExecutionRecord } from './AgentExecutionSchema.js';

describe('AgentExecution', () => {
    it('materializes terminal identity through terminalHandle only', () => {
        const data = AgentExecution.toDataFromRecord(createAgentExecutionRecord({
            terminalHandle: {
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(data).toMatchObject({
            id: 'agent_execution:mission-1/session-1',
            sessionId: 'session-1',
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
        expect(data.runtimeMessages.map((message) => message.type)).toEqual([
            'interrupt',
            'checkpoint',
            'nudge'
        ]);
        expect('terminalName' in data).toBe(false);
        expect('terminalPaneId' in data).toBe(false);
    });

    it('derives agent-message capabilities for non-terminals that accept structured follow-up input', () => {
        const snapshot: AgentExecutionSnapshot = {
            agentId: 'codex',
            sessionId: 'session-2',
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
            status: 'awaiting-input',
            attention: 'awaiting-operator',
            progress: {
                state: 'waiting-input',
                updatedAt: '2026-05-04T00:00:00.000Z'
            },
            waitingForInput: true,
            acceptsPrompts: true,
            acceptedCommands: ['resume', 'checkpoint'],
            interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
                status: 'awaiting-input',
                acceptsPrompts: true,
                acceptedCommands: ['resume', 'checkpoint']
            }),
            reference: {
                agentId: 'codex',
                sessionId: 'session-2'
            },
            startedAt: '2026-05-04T00:00:00.000Z',
            updatedAt: '2026-05-04T00:00:00.000Z'
        };

        const state = AgentExecution.createStateFromSnapshot({
            snapshot,
            adapterLabel: 'Codex'
        });

        expect(state.interactionCapabilities).toEqual({
            mode: 'agent-message',
            canSendTerminalInput: false,
            canSendStructuredPrompt: true,
            canSendStructuredCommand: true
        });
        expect(state.runtimeMessages.map((message) => message.type)).toEqual([
            'checkpoint',
            'resume'
        ]);
    });

    it('rejects duplicate top-level terminal identity in AgentExecution data', () => {
        const data = AgentExecution.toDataFromRecord(createAgentExecutionRecord({
            terminalHandle: {
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(() => AgentExecutionDataSchema.parse({
            ...data,
            terminalName: 'mission-agent-execution'
        })).toThrow();
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
            markerPrefix: 'task::'
        });

        expect(deriveAgentExecutionProtocolOwner({
            kind: 'repository',
            repositoryRootPath: '/repo/mission'
        })).toEqual({
            entity: 'Repository',
            entityId: '/repo/mission',
            markerPrefix: 'repository::'
        });
    });

    it('exposes the protocol descriptor as the source of truth for messages and signals', () => {
        const descriptor = AgentExecution.createProtocolDescriptorForSnapshot(createRuntimeSnapshot());

        expect(AgentExecutionProtocolDescriptorSchema.parse(descriptor)).toEqual(descriptor);
        expect(descriptor.owner).toEqual({
            entity: 'Task',
            entityId: 'task-2',
            markerPrefix: 'task::'
        });
        expect(descriptor.messages.map((message) => message.type)).toEqual([
            'interrupt',
            'checkpoint',
            'nudge'
        ]);
        expect(descriptor.signals.map((signal) => signal.type)).toEqual([
            'progress',
            'needs_input',
            'blocked',
            'ready_for_verification',
            'completed_claim',
            'failed_claim',
            'message'
        ]);
        expect(new Set(descriptor.signals.map((signal) => signal.delivery))).toEqual(new Set(['stdout-marker']));
    });

    it('materializes protocol descriptors on live AgentExecution data', () => {
        const data = AgentExecution.createLive(createRuntimeSnapshot()).toData();

        expect(data.protocolDescriptor?.owner).toEqual({
            entity: 'Task',
            entityId: 'task-2',
            markerPrefix: 'task::'
        });
        expect(data.protocolDescriptor?.messages).toEqual(data.runtimeMessages);
    });
});

function createAgentExecutionRecord(overrides: Partial<AgentExecutionRecord> = {}): AgentExecutionRecord {
    return {
        sessionId: 'session-1',
        agentId: 'copilot-cli',
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
        runtimeMessages: AgentExecution.createRuntimeMessageDescriptorsForCommands([
            'interrupt',
            'checkpoint',
            'nudge'
        ]),
        scope: {
            kind: 'slice',
            missionId: 'mission-1',
            sliceTitle: 'Implement task',
            verificationTargets: [],
            requiredSkills: [],
            dependsOn: []
        },
        ...overrides
    };
}

function createRuntimeSnapshot(): AgentExecutionSnapshot {
    return {
        agentId: 'codex',
        sessionId: 'session-2',
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
            sessionId: 'session-2',
            transport: {
                kind: 'terminal',
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            }
        },
        startedAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z'
    };
}
