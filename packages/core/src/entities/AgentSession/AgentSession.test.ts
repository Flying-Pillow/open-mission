import { describe, expect, it } from 'vitest';
import { AgentSession } from './AgentSession.js';
import { AgentSessionContract } from './AgentSessionContract.js';
import { AgentSessionDataSchema } from './AgentSessionSchema.js';
import type { AgentSessionRecord } from '../../daemon/protocol/contracts.js';

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
            terminalHandle: {
                sessionName: 'mission-agent-session',
                paneId: 'terminal_1'
            }
        });
        expect('terminalSessionName' in data).toBe(false);
        expect('terminalPaneId' in data).toBe(false);
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
        expect(Object.keys(AgentSessionContract.events ?? {})).toEqual(['data.changed']);
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