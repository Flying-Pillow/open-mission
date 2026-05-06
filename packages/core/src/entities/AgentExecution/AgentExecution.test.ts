import { describe, expect, it } from 'vitest';
import { deriveAgentExecutionInteractionCapabilities, type AgentExecutionSnapshot } from './AgentExecutionProtocolTypes.js';
import { AgentExecution } from './AgentExecution.js';
import { AgentExecutionContract } from './AgentExecutionContract.js';
import { AgentExecutionDataSchema } from './AgentExecutionSchema.js';
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
