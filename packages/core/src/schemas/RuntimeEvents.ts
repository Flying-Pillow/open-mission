import { z } from 'zod/v4';
import {
    agentSessionEntityReferenceSchema,
    missionAgentSessionSnapshotSchema
} from './AgentSession.js';
import {
    artifactEntityReferenceSchema,
    missionArtifactSnapshotSchema
} from './Artifact.js';
import {
    missionActionListSnapshotSchema,
    missionEntityReferenceSchema,
    missionSnapshotSchema,
    missionStatusSnapshotSchema
} from './Mission.js';
import {
    missionStageSnapshotSchema,
    stageEntityReferenceSchema
} from './Stage.js';
import {
    missionTaskSnapshotSchema,
    taskEntityReferenceSchema
} from './Task.js';

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
    reference: missionEntityReferenceSchema.optional(),
    actions: missionActionListSnapshotSchema.optional(),
    revision: nonEmptyStringSchema.optional()
}).strict();

export const missionSnapshotChangedRuntimeEventPayloadSchema = z.object({
    reference: missionEntityReferenceSchema,
    snapshot: missionSnapshotSchema
}).strict();

export const missionStatusRuntimeEventPayloadSchema = z.object({
    missionId: nonEmptyStringSchema,
    status: missionStatusSnapshotSchema
}).strict();

export const stageSnapshotChangedRuntimeEventPayloadSchema = z.object({
    reference: stageEntityReferenceSchema,
    snapshot: missionStageSnapshotSchema
}).strict();

export const taskSnapshotChangedRuntimeEventPayloadSchema = z.object({
    reference: taskEntityReferenceSchema,
    snapshot: missionTaskSnapshotSchema
}).strict();

export const artifactSnapshotChangedRuntimeEventPayloadSchema = z.object({
    reference: artifactEntityReferenceSchema,
    snapshot: missionArtifactSnapshotSchema
}).strict();

export const agentSessionSnapshotChangedRuntimeEventPayloadSchema = z.object({
    reference: agentSessionEntityReferenceSchema,
    snapshot: missionAgentSessionSnapshotSchema
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
    'mission.snapshot.changed',
    'mission.actions.changed',
    'mission.status',
    'stage.snapshot.changed',
    'task.snapshot.changed',
    'artifact.snapshot.changed',
    'agentSession.snapshot.changed',
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
        type: z.literal('mission.snapshot.changed'),
        missionId: nonEmptyStringSchema,
        payload: missionSnapshotChangedRuntimeEventPayloadSchema
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
        type: z.literal('stage.snapshot.changed'),
        missionId: nonEmptyStringSchema,
        payload: stageSnapshotChangedRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('task.snapshot.changed'),
        missionId: nonEmptyStringSchema,
        payload: taskSnapshotChangedRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('artifact.snapshot.changed'),
        missionId: nonEmptyStringSchema,
        payload: artifactSnapshotChangedRuntimeEventPayloadSchema
    }).strict(),
    baseRuntimeEventEnvelopeSchema.extend({
        type: z.literal('agentSession.snapshot.changed'),
        missionId: nonEmptyStringSchema,
        payload: agentSessionSnapshotChangedRuntimeEventPayloadSchema
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
