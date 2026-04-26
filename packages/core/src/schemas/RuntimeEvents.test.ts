import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { airportRuntimeEventEnvelopeSchema } from './RuntimeEvents.js';

describe('Airport runtime event schemas', () => {
    it('validates typed Mission status projection payloads', () => {
        const event = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-1',
            type: 'mission.status',
            occurredAt: '2026-04-26T15:00:00.000Z',
            missionId: 'mission-29',
            payload: {
                missionId: 'mission-29',
                status: {
                    missionId: 'mission-29',
                    title: 'Mission 29',
                    workflow: {
                        lifecycle: 'running',
                        currentStageId: 'implementation',
                        stages: []
                    }
                }
            }
        });

        if (event.type !== 'mission.status') {
            throw new Error(`Expected mission.status, received ${event.type}.`);
        }

        expect(event.type).toBe('mission.status');
        expect(event.payload.status.missionId).toBe('mission-29');
    });

    it('validates typed AgentSession event payloads', () => {
        const event = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-2',
            type: 'session.event',
            occurredAt: '2026-04-26T15:01:00.000Z',
            missionId: 'mission-29',
            payload: {
                missionId: 'mission-29',
                sessionId: 'session-1',
                session: {
                    sessionId: 'session-1',
                    runnerId: 'copilot-cli',
                    runnerLabel: 'Copilot CLI',
                    lifecycleState: 'running',
                    taskId: 'implementation/12-wire-mission-projections-and-remove-runtime-routes'
                }
            }
        });

        if (event.type !== 'session.event') {
            throw new Error(`Expected session.event, received ${event.type}.`);
        }

        expect(event.type).toBe('session.event');
        expect(event.payload.session.sessionId).toBe('session-1');
    });

    it('validates typed Mission and child entity snapshot projection payloads', () => {
        const missionEvent = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-mission-snapshot',
            type: 'mission.snapshot.changed',
            occurredAt: '2026-04-26T15:01:00.000Z',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Mission',
                    missionId: 'mission-29'
                },
                snapshot: {
                    mission: {
                        missionId: 'mission-29',
                        artifacts: [],
                        stages: []
                    },
                    stages: [],
                    tasks: [],
                    artifacts: [],
                    agentSessions: []
                }
            }
        });
        const taskEvent = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-task-snapshot',
            type: 'task.snapshot.changed',
            occurredAt: '2026-04-26T15:01:01.000Z',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Task',
                    missionId: 'mission-29',
                    taskId: 'implementation/16-wire-child-entity-projections'
                },
                snapshot: createTaskSnapshot({ lifecycle: 'completed' })
            }
        });
        const stageEvent = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-stage-snapshot',
            type: 'stage.snapshot.changed',
            occurredAt: '2026-04-26T15:01:02.000Z',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Stage',
                    missionId: 'mission-29',
                    stageId: 'implementation'
                },
                snapshot: {
                    stageId: 'implementation',
                    lifecycle: 'running',
                    isCurrentStage: true,
                    artifacts: [],
                    tasks: [createTaskSnapshot({ lifecycle: 'running' })]
                }
            }
        });
        const artifactEvent = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-artifact-snapshot',
            type: 'artifact.snapshot.changed',
            occurredAt: '2026-04-26T15:01:03.000Z',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Artifact',
                    missionId: 'mission-29',
                    artifactId: '03-IMPLEMENTATION/VERIFY.md'
                },
                snapshot: {
                    artifactId: '03-IMPLEMENTATION/VERIFY.md',
                    kind: 'mission',
                    label: 'VERIFY.md',
                    fileName: 'VERIFY.md',
                    relativePath: '03-IMPLEMENTATION/VERIFY.md'
                }
            }
        });
        const sessionEvent = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-agent-session-snapshot',
            type: 'agentSession.snapshot.changed',
            occurredAt: '2026-04-26T15:01:04.000Z',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'AgentSession',
                    missionId: 'mission-29',
                    sessionId: 'session-1'
                },
                snapshot: {
                    sessionId: 'session-1',
                    runnerId: 'copilot-cli',
                    runnerLabel: 'Copilot CLI',
                    lifecycleState: 'running'
                }
            }
        });

        if (missionEvent.type !== 'mission.snapshot.changed') {
            throw new Error(`Expected mission.snapshot.changed, received ${missionEvent.type}.`);
        }
        if (taskEvent.type !== 'task.snapshot.changed') {
            throw new Error(`Expected task.snapshot.changed, received ${taskEvent.type}.`);
        }
        if (stageEvent.type !== 'stage.snapshot.changed') {
            throw new Error(`Expected stage.snapshot.changed, received ${stageEvent.type}.`);
        }
        if (artifactEvent.type !== 'artifact.snapshot.changed') {
            throw new Error(`Expected artifact.snapshot.changed, received ${artifactEvent.type}.`);
        }
        if (sessionEvent.type !== 'agentSession.snapshot.changed') {
            throw new Error(`Expected agentSession.snapshot.changed, received ${sessionEvent.type}.`);
        }

        expect(missionEvent.payload.reference.entity).toBe('Mission');
        expect(taskEvent.payload.snapshot.lifecycle).toBe('completed');
        expect(stageEvent.payload.snapshot.tasks).toHaveLength(1);
        expect(artifactEvent.payload.reference.entity).toBe('Artifact');
        expect(sessionEvent.payload.snapshot.sessionId).toBe('session-1');
    });

    it('keeps terminal stream events separate from typed projection payloads', () => {
        const event = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-terminal-stream',
            type: 'session.terminal',
            occurredAt: '2026-04-26T15:01:05.000Z',
            missionId: 'mission-29',
            payload: {
                type: 'session.terminal',
                missionId: 'mission-29',
                sessionId: 'session-1',
                state: {
                    sessionId: 'session-1',
                    connected: true,
                    dead: false,
                    exitCode: null,
                    screen: 'terminal bytes stay transport data'
                }
            }
        });

        expect(event.type).toBe('session.terminal');
    });

    it('keeps session lifecycle notifications typed without requiring a full session snapshot', () => {
        const event = airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-3',
            type: 'session.lifecycle',
            occurredAt: '2026-04-26T15:02:00.000Z',
            missionId: 'mission-29',
            payload: {
                missionId: 'mission-29',
                sessionId: 'session-1',
                phase: 'active',
                lifecycleState: 'idle'
            }
        });

        if (event.type !== 'session.lifecycle') {
            throw new Error(`Expected session.lifecycle, received ${event.type}.`);
        }

        expect(event.type).toBe('session.lifecycle');
        expect(event.payload.lifecycleState).toBe('idle');
    });

    it('rejects malformed projection payloads', () => {
        expect(() => airportRuntimeEventEnvelopeSchema.parse({
            eventId: 'event-4',
            type: 'mission.status',
            occurredAt: '2026-04-26T15:03:00.000Z',
            missionId: 'mission-29',
            payload: {
                missionId: 'mission-29',
                status: {
                    missionId: ''
                }
            }
        })).toThrow(ZodError);
    });
});

function createTaskSnapshot(input: { lifecycle: string }) {
    return {
        taskId: 'implementation/16-wire-child-entity-projections',
        stageId: 'implementation',
        sequence: 16,
        title: 'Wire Child Entity Projections',
        instruction: 'Wire child entity projections by entity reference.',
        lifecycle: input.lifecycle,
        dependsOn: [],
        waitingOnTaskIds: [],
        agentRunner: 'copilot-cli',
        retries: 0
    };
}