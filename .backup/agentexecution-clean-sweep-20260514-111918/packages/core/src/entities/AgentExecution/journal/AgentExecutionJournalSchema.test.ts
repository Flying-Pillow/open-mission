import { describe, expect, it } from 'vitest';
import { createAgentExecutionProtocolDescriptor } from '../input/AgentExecutionCommunicationDescriptor.js';
import {
    AgentExecutionActivityUpdatedRecordSchema,
    AgentExecutionDecisionRecordSchema,
    AgentExecutionJournalHeaderRecordSchema,
    AgentExecutionJournalRecordSchema,
    AgentExecutionMessageAcceptedRecordSchema,
    AgentExecutionMessageDeliveryRecordSchema,
    AgentExecutionObservationRecordSchema,
    AgentExecutionFactRecordSchema,
    AgentExecutionOwnerEffectRecordSchema,
    AgentExecutionTimelineRecordSchema,
    AgentExecutionStateChangedRecordSchema
} from './AgentExecutionJournalSchema.js';

describe('AgentExecutionJournalSchema', () => {
    it('accepts every phase-one journal record kind', () => {
        const records = [
            AgentExecutionJournalHeaderRecordSchema.parse({
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
            }),
            AgentExecutionMessageAcceptedRecordSchema.parse({
                ...baseRecord('turn.accepted', 1),
                messageId: 'message-1',
                source: 'operator',
                messageType: 'prompt',
                payload: { text: 'Continue.' },
                mutatesContext: false
            }),
            AgentExecutionMessageDeliveryRecordSchema.parse({
                ...baseRecord('turn.delivery', 2),
                messageId: 'message-1',
                status: 'attempted',
                transport: 'pty-terminal'
            }),
            AgentExecutionObservationRecordSchema.parse({
                ...baseRecord('agent-observation', 3),
                observationId: 'observation-1',
                source: 'mcp',
                confidence: 'medium',
                signal: {
                    type: 'progress',
                    source: 'agent-signal',
                    confidence: 'medium',
                    summary: 'Working through the first task.'
                }
            }),
            AgentExecutionFactRecordSchema.parse({
                ...baseRecord('agent-execution-fact', 4),
                origin: 'filesystem',
                factId: 'fact-1',
                factType: 'artifact-read',
                path: 'BRIEF.md',
                detail: 'Mission artifact body was read through a Mission-owned surface.'
            }),
            AgentExecutionDecisionRecordSchema.parse({
                ...baseRecord('decision.recorded', 5),
                decisionId: 'decision-1',
                observationId: 'observation-1',
                action: 'update-state'
            }),
            AgentExecutionStateChangedRecordSchema.parse({
                ...baseRecord('state.changed', 6),
                lifecycle: 'running',
                attention: 'autonomous',
                activity: 'executing'
            }),
            AgentExecutionActivityUpdatedRecordSchema.parse({
                ...baseRecord('activity.updated', 7),
                progress: {
                    summary: 'Running tests',
                    units: { completed: 1, total: 3, unit: 'suite' }
                },
                telemetry: {
                    activeToolName: 'run_in_terminal'
                },
                capabilities: {
                    terminalAttached: true,
                    toolCallActive: true
                },
                currentTarget: {
                    kind: 'command',
                    label: 'pnpm test'
                }
            }),
            AgentExecutionOwnerEffectRecordSchema.parse({
                ...baseRecord('owner-effect.recorded', 8),
                effectId: 'effect-1',
                observationId: 'observation-1',
                ownerEntity: 'Task',
                effectType: 'task.execution.updated',
                workflowEventId: 'workflow-event-1'
            }),
            AgentExecutionTimelineRecordSchema.parse({
                ...baseRecord('timeline.recorded', 9),
                timeline: 'timeline-item',
                payload: {
                    id: 'timeline-item-1',
                    occurredAt: '2026-05-09T00:00:08.000Z',
                    zone: 'conversation',
                    primitive: 'conversation.agent-message',
                    behavior: {
                        class: 'conversational',
                        compactable: false,
                        collapsible: false,
                        sticky: false,
                        actionable: false,
                        replayRelevant: true,
                        transient: false,
                        defaultExpanded: true
                    },
                    provenance: {
                        durable: true,
                        sourceRecordIds: ['record-8'],
                        confidence: 'authoritative'
                    },
                    payload: { text: 'Working through the first task.' }
                }
            })
        ];

        expect(records.map((record) => AgentExecutionJournalRecordSchema.parse(record).type)).toEqual([
            'journal.header',
            'turn.accepted',
            'turn.delivery',
            'agent-observation',
            'agent-execution-fact',
            'decision.recorded',
            'state.changed',
            'activity.updated',
            'owner-effect.recorded',
            'timeline.recorded'
        ]);
    });

    it('rejects terminal recordings as semantic journal records', () => {
        expect(() => AgentExecutionJournalRecordSchema.parse({
            type: 'output',
            at: '2026-05-09T00:00:00.000Z',
            data: 'raw terminal output'
        })).toThrow();
    });

    it('keeps runtime telemetry out of semantic state changes', () => {
        expect(() => AgentExecutionStateChangedRecordSchema.parse({
            ...baseRecord('state.changed', 1),
            lifecycle: 'running',
            telemetry: {
                activeToolName: 'edit'
            }
        })).toThrow();

        expect(AgentExecutionActivityUpdatedRecordSchema.parse({
            ...baseRecord('activity.updated', 2),
            telemetry: {
                activeToolName: 'edit'
            }
        }).telemetry).toEqual({
            activeToolName: 'edit'
        });
    });
});

function baseRecord(type: string, sequence: number) {
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
        entrySemantics: type === 'activity.updated' || type === 'timeline.recorded'
            ? 'snapshot'
            : 'event',
        authority: type === 'turn.accepted' ? 'operator' : 'daemon',
        assertionLevel: type === 'turn.delivery' ? 'informational' : 'authoritative',
        replayClass: type === 'turn.delivery' || type === 'activity.updated' || type === 'timeline.recorded'
            ? 'replay-optional'
            : 'replay-critical',
        origin: type === 'agent-execution-fact' ? 'filesystem' : 'daemon',
        schemaVersion: 1,
        agentExecutionId: 'agent-execution-1',
        executionContext: {
            scope: {
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
        occurredAt: '2026-05-09T00:00:00.000Z'
    };
}
