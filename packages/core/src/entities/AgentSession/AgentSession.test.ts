import { describe, expect, it } from 'vitest';
import { deriveAgentSessionInteractionCapabilities, type AgentSessionSnapshot } from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import { AgentSession } from './AgentSession.js';
import { AgentSessionContract } from './AgentSessionContract.js';
import { AgentSessionDataSchema } from './AgentSessionSchema.js';
import type { AgentSessionRecord } from './AgentSessionSchema.js';

describe('AgentSession', () => {
    it('materializes terminal identity through terminalHandle only', () => {
        const data = AgentSession.toDataFromRecord(createAgentSessionRecord({
            terminalHandle: {
                sessionName: 'mission-agent-session',
                paneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(data).toMatchObject({
            id: 'agent_session:mission-1/session-1',
            sessionId: 'session-1',
            transportId: 'terminal',
            interactionCapabilities: {
                mode: 'pty-terminal',
                canSendTerminalInput: true,
                canSendStructuredPrompt: false,
                canSendStructuredCommand: false
            },
            terminalHandle: {
                sessionName: 'mission-agent-session',
                paneId: 'terminal_1'
            }
        });
        expect(data.runtimeMessages.map((message) => message.type)).toEqual([
            'interrupt',
            'checkpoint',
            'nudge'
        ]);
        expect('terminalSessionName' in data).toBe(false);
        expect('terminalPaneId' in data).toBe(false);
    });

    it('derives agent-message capabilities for non-terminal sessions that accept structured follow-up input', () => {
        const snapshot: AgentSessionSnapshot = {
            runnerId: 'codex',
            sessionId: 'session-2',
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
            interactionCapabilities: deriveAgentSessionInteractionCapabilities({
                status: 'awaiting-input',
                acceptsPrompts: true,
                acceptedCommands: ['resume', 'checkpoint']
            }),
            reference: {
                runnerId: 'codex',
                sessionId: 'session-2'
            },
            startedAt: '2026-05-04T00:00:00.000Z',
            updatedAt: '2026-05-04T00:00:00.000Z'
        };

        const state = AgentSession.createStateFromSnapshot({
            snapshot,
            runnerLabel: 'Codex'
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

    it('rejects duplicate top-level terminal identity in AgentSession data', () => {
        const data = AgentSession.toDataFromRecord(createAgentSessionRecord({
            terminalHandle: {
                sessionName: 'mission-agent-session',
                paneId: 'terminal_1'
            },
            transportId: 'terminal'
        }));

        expect(() => AgentSessionDataSchema.parse({
            ...data,
            terminalSessionName: 'mission-agent-session'
        })).toThrow();
    });

    it('advertises concrete AgentSession contract events only', () => {
        expect(Object.keys(AgentSessionContract.events ?? {})).toEqual(['data.changed', 'terminal']);
    });
});

function createAgentSessionRecord(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
    return {
        sessionId: 'session-1',
        runnerId: 'copilot-cli',
        runnerLabel: 'Copilot CLI',
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
        runtimeMessages: AgentSession.createRuntimeMessageDescriptorsForCommands([
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
