import { describe, expect, it } from 'vitest';
import { createAgentExecutionProtocolDescriptor } from './AgentExecutionProtocolDescriptor.js';
import {
    hydrateAgentExecutionDataFromJournal,
    replayAgentExecutionJournal
} from './AgentExecutionJournalReplayer.js';
import { AgentExecutionDataSchema, type AgentExecutionDataType } from './AgentExecutionSchema.js';
import type { AgentExecutionJournalRecordType } from './AgentExecutionJournalSchema.js';

describe('AgentExecutionJournalReplayer', () => {
    it('replays chat projection and processed ids from semantic journal records', () => {
        const replay = replayAgentExecutionJournal([
            createHeaderRecord(),
            {
                ...baseRecord('message.accepted', 1),
                messageId: 'message-1',
                source: 'operator',
                messageType: 'prompt',
                payload: { text: 'Continue.' },
                mutatesContext: false
            },
            {
                ...baseRecord('observation.recorded', 2),
                observationId: 'observation-1',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'progress',
                    summary: 'Working through the next slice.',
                    source: 'agent-declared',
                    confidence: 'medium'
                }
            },
            {
                ...baseRecord('state.changed', 3),
                lifecycle: 'running',
                attention: 'awaiting-operator',
                activity: 'communicating',
                currentInputRequestId: 'observation-2'
            },
            {
                ...baseRecord('activity.updated', 4),
                activity: 'reviewing',
                progress: {
                    summary: 'Reviewing the generated patch.',
                    units: {
                        completed: 1,
                        total: 2,
                        unit: 'steps'
                    }
                },
                telemetry: {
                    inputTokens: 12,
                    outputTokens: 34,
                    totalTokens: 46,
                    activeToolName: 'apply_patch'
                },
                capabilities: {
                    terminalAttached: true,
                    toolCallActive: true
                },
                currentTarget: {
                    kind: 'file',
                    path: '/repo/file.ts',
                    label: 'file.ts'
                }
            }
        ]);

        expect([...replay.processedMessageIds]).toEqual(['message-1']);
        expect([...replay.processedObservationIds]).toEqual(['observation-1']);
        expect(replay.chatMessages).toEqual([
            expect.objectContaining({ id: 'message-1', role: 'operator', text: 'Continue.' }),
            expect.objectContaining({ id: 'observation-1', kind: 'progress', text: 'Working through the next slice.' })
        ]);
        expect(replay.protocolDescriptor).toBeDefined();
        expect(replay.transportState).toEqual({ selected: 'stdout-marker', degraded: false });
        expect(replay.lifecycleState).toBe('running');
        expect(replay.attention).toBe('awaiting-operator');
        expect(replay.semanticActivity).toBe('communicating');
        expect(replay.currentInputRequestId).toBe('observation-2');
        expect(replay.runtimeActivity).toEqual({
            activity: 'reviewing',
            progress: {
                summary: 'Reviewing the generated patch.',
                units: {
                    completed: 1,
                    total: 2,
                    unit: 'steps'
                }
            },
            capabilities: {
                terminalAttached: true,
                toolCallActive: true
            },
            currentTarget: {
                kind: 'file',
                path: '/repo/file.ts',
                label: 'file.ts'
            },
            updatedAt: '2026-05-09T00:00:04.000Z'
        });
        expect(replay.telemetry).toEqual({
            activeToolName: 'apply_patch',
            updatedAt: '2026-05-09T00:00:04.000Z',
            tokenUsage: {
                inputTokens: 12,
                outputTokens: 34,
                totalTokens: 46
            }
        });
    });

    it('hydrates AgentExecution data from the journal projection', () => {
        const baseData = AgentExecutionDataSchema.parse({
            id: 'agent_execution:mission-1/agent-execution-1',
            ownerId: 'mission-1',
            agentExecutionId: 'agent-execution-1',
            agentId: 'copilot-cli',
            adapterLabel: 'Copilot CLI',
            lifecycleState: 'running',
            interactionCapabilities: {
                mode: 'agent-message',
                canSendTerminalInput: false,
                canSendStructuredPrompt: true,
                canSendStructuredCommand: true
            },
            context: { artifacts: [], instructions: [] },
            runtimeMessages: [],
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            agentJournalPath: 'agent-journals/agent-execution-1.interaction.jsonl',
            chatMessages: []
        } satisfies Partial<AgentExecutionDataType>);

        const hydrated = hydrateAgentExecutionDataFromJournal(baseData, [
            createHeaderRecord(),
            {
                ...baseRecord('message.accepted', 1),
                messageId: 'message-1',
                source: 'system',
                messageType: 'prompt',
                payload: { text: 'Start here.' },
                mutatesContext: false
            },
            {
                ...baseRecord('state.changed', 2),
                lifecycle: 'running',
                attention: 'autonomous',
                activity: 'executing',
                currentInputRequestId: null
            },
            {
                ...baseRecord('activity.updated', 3),
                activity: 'executing',
                progress: {
                    summary: 'Running the first slice.'
                },
                capabilities: {
                    streaming: true
                }
            }
        ]);

        expect(hydrated.protocolDescriptor).toBeDefined();
        expect(hydrated.transportState).toEqual({ selected: 'stdout-marker', degraded: false });
        expect(hydrated.lifecycleState).toBe('running');
        expect(hydrated.attention).toBe('autonomous');
        expect(hydrated.semanticActivity).toBe('executing');
        expect(hydrated.currentInputRequestId).toBeNull();
        expect(hydrated.runtimeActivity).toEqual({
            activity: 'executing',
            progress: {
                summary: 'Running the first slice.'
            },
            capabilities: {
                streaming: true
            },
            updatedAt: '2026-05-09T00:00:03.000Z'
        });
        expect(hydrated.chatMessages).toEqual([
            expect.objectContaining({ id: 'message-1', role: 'system', text: 'Start here.' })
        ]);
    });
});

function createHeaderRecord(): AgentExecutionJournalRecordType {
    return {
        ...baseRecord('journal.header', 0),
        kind: 'agent-execution-interaction-journal',
        agentId: 'copilot-cli',
        protocolDescriptor: createAgentExecutionProtocolDescriptor({
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            messages: []
        }),
        transportState: {
            selected: 'stdout-marker',
            degraded: false
        },
        workingDirectory: '/repo'
    };
}

function baseRecord(type: AgentExecutionJournalRecordType['type'], sequence: number) {
    return {
        recordId: `record-${sequence}`,
        sequence,
        type,
        schemaVersion: 1 as const,
        agentExecutionId: 'agent-execution-1',
        ownerId: 'mission-1',
        scope: {
            kind: 'task' as const,
            missionId: 'mission-1',
            taskId: 'task-1'
        },
        occurredAt: `2026-05-09T00:00:0${sequence}.000Z`
    };
}