import { z } from 'zod/v4';
import {
    missionAgentSessionSnapshotSchema,
    missionStatusSnapshotSchema
} from './Mission.js';

const nonEmptyStringSchema = z.string().trim().min(1);

const baseRuntimeEventEnvelopeSchema = z.object({
    eventId: nonEmptyStringSchema,
    occurredAt: nonEmptyStringSchema
});

const sessionLifecycleStateSchema = z.enum([
    'idle',
    'starting',
    'running',
    'awaiting-input',
    'completed',
    'failed',
    'cancelled',
    'terminated'
]);

export const airportStateRuntimeEventPayloadSchema = z.object({
    snapshot: z.unknown()
}).strict();

export const missionActionsChangedRuntimeEventPayloadSchema = z.object({
    missionId: nonEmptyStringSchema,
    revision: nonEmptyStringSchema.optional()
}).strict();

export const missionStatusRuntimeEventPayloadSchema = z.object({
    missionId: nonEmptyStringSchema,
    status: missionStatusSnapshotSchema
}).strict();

export const sessionEventRuntimeEventPayloadSchema = z.object({
    missionId: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    session: missionAgentSessionSnapshotSchema
}).strict();

export const sessionLifecycleRuntimeEventPayloadSchema = z.object({
    missionId: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    phase: z.enum(['spawned', 'active', 'terminated']),
    lifecycleState: sessionLifecycleStateSchema
}).strict();

export const airportRuntimeEventTypeSchema = z.enum([
    'airport.state',
    'mission.actions.changed',
    'mission.status',
    'session.console',
    'session.terminal',
    'session.event',
    'session.lifecycle'
]);

export const airportRuntimeEventEnvelopeSchema = z.discriminatedUnion('type', [
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('airport.state'),
        payload: airportStateRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('mission.actions.changed'),
        missionId: nonEmptyStringSchema,
        payload: missionActionsChangedRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('mission.status'),
        missionId: nonEmptyStringSchema,
        payload: missionStatusRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('session.console'),
        missionId: nonEmptyStringSchema,
        payload: z.unknown()
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('session.terminal'),
        missionId: nonEmptyStringSchema,
        payload: z.unknown()
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('session.event'),
        missionId: nonEmptyStringSchema,
        payload: sessionEventRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('session.lifecycle'),
        missionId: nonEmptyStringSchema,
        payload: sessionLifecycleRuntimeEventPayloadSchema
    }).strict()
]);

export type AirportRuntimeEventEnvelope = z.infer<typeof airportRuntimeEventEnvelopeSchema>;
export type AirportRuntimeEventType = z.infer<typeof airportRuntimeEventTypeSchema>;
