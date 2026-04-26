import { z } from 'zod/v4';

export const airportRuntimeEventTypeSchema = z.enum([
    'airport.state',
    'mission.actions.changed',
    'mission.status',
    'session.console',
    'session.terminal',
    'session.event',
    'session.lifecycle'
]);

export const airportRuntimeEventEnvelopeSchema = z.object({
    eventId: z.string().trim().min(1),
    type: airportRuntimeEventTypeSchema,
    occurredAt: z.string().trim().min(1),
    missionId: z.string().trim().min(1).optional(),
    payload: z.unknown()
}).strict();

export type AirportRuntimeEventEnvelope = z.infer<typeof airportRuntimeEventEnvelopeSchema>;
export type AirportRuntimeEventType = z.infer<typeof airportRuntimeEventTypeSchema>;
