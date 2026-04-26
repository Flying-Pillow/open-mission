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