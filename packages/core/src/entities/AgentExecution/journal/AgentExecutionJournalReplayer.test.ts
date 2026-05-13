import { describe, expect, it } from 'vitest';
import { createAgentExecutionProtocolDescriptor } from '../protocol/AgentExecutionProtocolDescriptor.js';
import {
    hydrateAgentExecutionDataFromJournal,
    replayAgentExecutionJournal
} from './AgentExecutionJournalReplayer.js';
import { AgentExecutionSchema, type AgentExecutionType } from '../AgentExecutionSchema.js';
import type { AgentExecutionJournalRecordType } from './AgentExecutionJournalSchema.js';

describe('AgentExecutionJournalReplayer', () => {
    it('replays timeline projection and processed ids from semantic journal records', () => {
        const replay = replayAgentExecutionJournal([
            createHeaderRecord(),
            {
                ...baseRecord('turn.accepted', 1),
                messageId: 'message-1',
                source: 'operator',
                messageType: 'prompt',
                payload: { text: 'Continue.' },
                mutatesContext: false
            },
            {
                ...baseRecord('agent-observation', 2),
                observationId: 'observation-1',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'progress',
                    summary: 'Working through the next slice.',
                    source: 'agent-signal',
                    confidence: 'medium'
                }
            },
            {
                ...baseRecord('agent-execution-fact', 3),
                origin: 'filesystem',
                factId: 'fact-1',
                factType: 'artifact-read',
                path: 'BRIEF.md',
                detail: 'Mission artifact body was read through a Mission-owned surface.'
            },
            {
                ...baseRecord('state.changed', 4),
                lifecycle: 'running',
                attention: 'awaiting-operator',
                activity: 'communicating',
                currentInputRequestId: 'observation-2',
                awaitingResponseToMessageId: null
            },
            {
                ...baseRecord('activity.updated', 5),
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
        expect(replay.projection.timelineItems).toEqual([
            expect.objectContaining({ id: 'message-1', primitive: 'conversation.operator-message', payload: expect.objectContaining({ text: 'Continue.' }) }),
            expect.objectContaining({ id: 'observation-1', primitive: 'activity.progress', payload: expect.objectContaining({ text: 'Working through the next slice.' }) }),
            expect.objectContaining({ id: 'fact-1', primitive: 'activity.tool', payload: expect.objectContaining({ title: 'Reading artifact', path: 'BRIEF.md' }) }),
            expect.objectContaining({ id: 'record-4:state', primitive: 'workflow.state-changed' }),
            expect.objectContaining({ id: 'record-5:activity', primitive: 'activity.progress' })
        ]);
        expect(replay.projection.currentActivity).toEqual({
            lifecycleState: 'running',
            attention: 'awaiting-operator',
            activity: 'reviewing',
            summary: 'Reviewing the generated patch.',
            units: {
                completed: 1,
                total: 2,
                unit: 'steps'
            },
            currentTarget: {
                kind: 'file',
                path: '/repo/file.ts',
                label: 'file.ts'
            },
            activeToolName: 'apply_patch',
            updatedAt: '2026-05-09T00:00:05.000Z'
        });
        expect(replay.projection.currentAttention).toEqual({
            state: 'awaiting-operator',
            primitive: 'attention.input-request',
            currentInputRequestId: 'observation-2',
            updatedAt: '2026-05-09T00:00:05.000Z'
        });
        expect(replay.protocolDescriptor).toBeDefined();
        expect(replay.transportState).toEqual({ selected: 'stdout-marker', degraded: false });
        expect(replay.lifecycleState).toBe('running');
        expect(replay.attention).toBe('awaiting-operator');
        expect(replay.activityState).toBe('reviewing');
        expect(replay.currentInputRequestId).toBe('observation-2');
        expect(replay.awaitingResponseToMessageId).toBeNull();
        expect(replay.liveActivity).toEqual({
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
            updatedAt: '2026-05-09T00:00:05.000Z'
        });
        expect(replay.telemetry).toEqual({
            activeToolName: 'apply_patch',
            updatedAt: '2026-05-09T00:00:05.000Z',
            tokenUsage: {
                inputTokens: 12,
                outputTokens: 34,
                totalTokens: 46
            }
        });
    });

    it('hydrates AgentExecution data from the journal projection', () => {
        const baseData = AgentExecutionSchema.parse({
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
            supportedMessages: [],
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            agentJournalPath: 'agent-journals/agent-execution-1.interaction.jsonl',
            projection: { timelineItems: [] }
        } satisfies Partial<AgentExecutionType>);

        const hydrated = hydrateAgentExecutionDataFromJournal(baseData, [
            createHeaderRecord(),
            {
                ...baseRecord('turn.accepted', 1),
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
        expect(hydrated.journalRecords).toEqual([
            expect.objectContaining({ recordId: 'record-0', type: 'journal.header' }),
            expect.objectContaining({ recordId: 'record-1', type: 'turn.accepted' }),
            expect.objectContaining({ recordId: 'record-2', type: 'state.changed' }),
            expect.objectContaining({ recordId: 'record-3', type: 'activity.updated' })
        ]);
        expect(hydrated.lifecycleState).toBe('running');
        expect(hydrated.attention).toBe('autonomous');
        expect(hydrated.activityState).toBe('executing');
        expect(hydrated.currentInputRequestId).toBeNull();
        expect(hydrated.liveActivity).toEqual({
            progress: {
                summary: 'Running the first slice.'
            },
            capabilities: {
                streaming: true
            },
            updatedAt: '2026-05-09T00:00:03.000Z'
        });
        expect(hydrated.projection.timelineItems).toEqual([
            expect.objectContaining({ id: 'message-1', primitive: 'conversation.system-message', payload: expect.objectContaining({ text: 'Start here.' }) }),
            expect.objectContaining({ id: 'record-2:state', primitive: 'workflow.state-changed' }),
            expect.objectContaining({ id: 'record-3:activity', primitive: 'activity.progress' })
        ]);
    });

    it('hydrates awaiting-agent-response from explicit state', () => {
        const baseData = AgentExecutionSchema.parse({
            id: 'agent_execution:mission-1/agent-execution-1',
            ownerId: 'mission-1',
            agentExecutionId: 'agent-execution-1',
            agentId: 'copilot-cli',
            adapterLabel: 'Copilot CLI',
            lifecycleState: 'running',
            activityState: 'executing',
            interactionCapabilities: {
                mode: 'agent-message',
                canSendTerminalInput: false,
                canSendStructuredPrompt: true,
                canSendStructuredCommand: true
            },
            context: { artifacts: [], instructions: [] },
            supportedMessages: [],
            projection: { timelineItems: [] }
        } satisfies Partial<AgentExecutionType>);

        const hydrated = hydrateAgentExecutionDataFromJournal(baseData, [
            createHeaderRecord(),
            {
                ...baseRecord('turn.accepted', 1),
                messageId: 'message-1',
                source: 'operator',
                messageType: 'prompt',
                payload: { text: 'Continue with the next step.' },
                mutatesContext: false
            },
            {
                ...baseRecord('state.changed', 2),
                lifecycle: 'running',
                attention: 'autonomous',
                activity: 'awaiting-agent-response',
                awaitingResponseToMessageId: 'message-1'
            }
        ]);

        expect(hydrated.activityState).toBe('awaiting-agent-response');
        expect(hydrated.liveActivity).toBeUndefined();
        expect(hydrated.projection.currentActivity).toEqual({
            lifecycleState: 'running',
            attention: 'autonomous',
            activity: 'awaiting-agent-response',
            updatedAt: '2026-05-09T00:00:02.000Z'
        });
        expect(hydrated.awaitingResponseToMessageId).toBe('message-1');
    });

    it('keeps the current input request payload when newer attention items exist', () => {
        const replay = replayAgentExecutionJournal([
            createHeaderRecord(),
            {
                ...baseRecord('agent-observation', 1),
                observationId: 'observation-needs-input-2',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'needs_input',
                    question: 'What should I focus on next?',
                    choices: [
                        { kind: 'fixed', label: 'Repository initialization', value: 'repo-init' },
                        { kind: 'fixed', label: 'Mission task work', value: 'mission-task' },
                        { kind: 'manual', label: 'Other', placeholder: 'Type your own answer' }
                    ],
                    source: 'agent-signal',
                    confidence: 'medium'
                }
            },
            {
                ...baseRecord('state.changed', 2),
                lifecycle: 'running',
                attention: 'awaiting-operator',
                activity: 'communicating',
                currentInputRequestId: 'observation-needs-input-2',
                awaitingResponseToMessageId: null
            },
            {
                ...baseRecord('agent-observation', 3),
                observationId: 'observation-review-1',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'ready_for_verification',
                    summary: 'Ready for review.',
                    source: 'agent-signal',
                    confidence: 'medium'
                }
            }
        ]);

        expect(replay.projection.currentAttention).toEqual({
            state: 'awaiting-operator',
            primitive: 'attention.input-request',
            title: 'Needs input',
            text: 'What should I focus on next?',
            choices: [
                { kind: 'fixed', label: 'Repository initialization', value: 'repo-init' },
                { kind: 'fixed', label: 'Mission task work', value: 'mission-task' },
                { kind: 'manual', label: 'Other', placeholder: 'Type your own answer' }
            ],
            currentInputRequestId: 'observation-needs-input-2',
            updatedAt: '2026-05-09T00:00:01.000Z'
        });
    });

    it('does not replay a stale input request as current attention after it is cleared', () => {
        const replay = replayAgentExecutionJournal([
            createHeaderRecord(),
            {
                ...baseRecord('agent-observation', 1),
                observationId: 'observation-needs-input-stale',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'needs_input',
                    question: 'Which option should I use?',
                    choices: [
                        { kind: 'fixed', label: 'Option A', value: 'a' },
                        { kind: 'manual', label: 'Something else', placeholder: 'Type your own answer' }
                    ],
                    source: 'agent-signal',
                    confidence: 'medium'
                }
            },
            {
                ...baseRecord('state.changed', 2),
                lifecycle: 'running',
                attention: 'awaiting-operator',
                activity: 'communicating',
                currentInputRequestId: 'observation-needs-input-stale',
                awaitingResponseToMessageId: null
            },
            {
                ...baseRecord('state.changed', 3),
                lifecycle: 'running',
                attention: 'awaiting-operator',
                activity: 'idle',
                currentInputRequestId: null,
                awaitingResponseToMessageId: null
            }
        ]);

        expect(replay.currentInputRequestId).toBeNull();
        expect(replay.projection.currentAttention).toEqual({
            state: 'awaiting-operator',
            primitive: 'attention.blocked',
            currentInputRequestId: null,
            updatedAt: '2026-05-09T00:00:03.000Z'
        });
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

function baseRecord<TType extends AgentExecutionJournalRecordType['type']>(
    type: TType,
    sequence: number
): any {
    return {
        recordId: `record-${sequence}`,
        sequence,
        type,
        family: type === 'journal.header'
            ? 'journal.header'
            : type === 'turn.accepted'
                ? 'turn.accepted'
                : type === 'turn.delivery'
                    ? 'turn.delivery'
                    : type === 'agent-observation'
                        ? 'agent-observation'
                        : type === 'agent-execution-fact'
                            ? 'agent-execution-fact'
                            : type,
        entrySemantics: type === 'activity.updated' || type === 'projection.recorded'
            ? 'snapshot'
            : 'event',
        authority: type === 'turn.accepted' ? 'operator' : 'daemon',
        assertionLevel: type === 'turn.delivery' ? 'informational' : 'authoritative',
        replayClass: type === 'turn.delivery' || type === 'activity.updated' || type === 'projection.recorded'
            ? 'replay-optional'
            : 'replay-critical',
        origin: type === 'agent-execution-fact' ? 'filesystem' : 'daemon',
        schemaVersion: 1 as const,
        agentExecutionId: 'agent-execution-1',
        executionContext: {
            owner: {
                entityType: 'Task',
                entityId: 'task-1'
            },
            mission: {
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            runtime: {
                agentAdapter: 'copilot-cli'
            },
            daemon: {
                runtimeVersion: 'test-runtime',
                protocolVersion: '2026-05-10'
            }
        },
        occurredAt: `2026-05-09T00:00:0${sequence}.000Z`
    } as const;
}