import { z } from 'zod/v4';
import { field, table } from '@flying-pillow/zod-surreal';
import {
    EntityCommandAcknowledgementSchema,
    EntityIdSchema,
    EntitySchema,
    EntityStorageSchema,
    IdSchema
} from '../Entity/EntitySchema.js';

export const agentExecutionEntityName = 'AgentExecution' as const;
export const agentExecutionJournalEntityName = 'AgentExecutionJournalRecord' as const;
export const agentExecutionTableName = 'agent_execution' as const;
export const agentExecutionJournalTableName = 'agent_execution_journal' as const;

export const AgentExecutionOwnerEntitySchema = z.enum([
    'System',
    'Repository',
    'Mission',
    'Task',
    'Artifact'
]);

export const AgentExecutionOwnerReferenceSchema = z.object({
    ownerEntity: AgentExecutionOwnerEntitySchema,
    ownerId: IdSchema
}).strict();

export const AgentExecutionLaunchModeSchema = z.enum(['interactive', 'print']);

export const AgentExecutionReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);

export const AgentExecutionLifecycleStateSchema = z.enum([
    'starting',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'terminated'
]);

export const AgentExecutionAttentionStateSchema = z.enum([
    'none',
    'autonomous',
    'awaiting-operator',
    'awaiting-system',
    'blocked'
]);

export const AgentExecutionActivityStateSchema = z.enum([
    'idle',
    'awaiting-agent-response',
    'planning',
    'reasoning',
    'communicating',
    'editing',
    'executing',
    'testing',
    'reviewing'
]);

export const AgentExecutionMessageDirectionSchema = z.enum(['incoming', 'outgoing']);

export const AgentExecutionMessageDeliverySchema = z.enum([
    'none',
    'best-effort',
    'required',
    'terminal-only'
]);

export const AgentExecutionCommandPortabilitySchema = z.enum([
    'mission-native',
    'cross-agent',
    'adapter-scoped',
    'terminal-only'
]);

export const AgentExecutionJournalEffectSchema = z.enum([
    'none',
    'append',
    'mutate'
]);

export const AgentExecutionMessageDescriptorSchema = z.object({
    direction: AgentExecutionMessageDirectionSchema.clone().register(field, {
        description: 'Direction of the AgentExecution message.'
    }),
    kind: z.string().trim().min(1).register(field, {
        description: 'Message kind handled by this AgentExecution.'
    }),
    delivery: AgentExecutionMessageDeliverySchema.clone().register(field, {
        description: 'Required delivery behavior for this message kind.'
    }),
    payloadSchemaKey: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional schema key for structured message payload validation.'
    }),
    label: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional operator-facing message label.'
    }),
    description: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Optional operator-facing message description.'
    }),
    startsTurn: z.boolean().optional().register(field, {
        optional: true,
        description: 'Whether accepting this message starts an AgentExecution turn.'
    }),
    portability: AgentExecutionCommandPortabilitySchema.optional().register(field, {
        optional: true,
        description: 'Portability scope for this message kind.'
    }),
    journalEffect: AgentExecutionJournalEffectSchema.default('append').register(field, {
        description: 'Durable journal effect produced by this message kind.'
    })
}).strict();

export const AgentExecutionMessageRegistrySchema = z.object({
    messages: z.array(AgentExecutionMessageDescriptorSchema).register(field, {
        description: 'Structured message descriptors supported by this AgentExecution.'
    })
}).strict();

export const AgentExecutionStructuredTransportSchema = z.enum([
    'none',
    'stdout-marker',
    'mcp-tool',
    'provider-structured'
]);

export const AgentExecutionTransportStatusSchema = z.enum([
    'available',
    'degraded',
    'unavailable',
    'recovering'
]);

export const AgentExecutionTransportStateSchema = z.object({
    status: AgentExecutionTransportStatusSchema.clone().register(field, {
        description: 'Current transport availability status.'
    }),
    structuredTransport: AgentExecutionStructuredTransportSchema.clone().register(field, {
        description: 'Structured transport currently available to this AgentExecution.'
    }),
    terminalInputAvailable: z.boolean().optional().register(field, {
        optional: true,
        description: 'Whether terminal input is currently available as a fallback transport.'
    }),
    reason: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Current transport degradation or unavailability reason.'
    })
}).strict();

export const AgentExecutionMcpAvailabilitySchema = z.enum(['available', 'unavailable']);

export const AgentExecutionJournalReferenceSchema = z.object({
    journalId: IdSchema.clone().register(field, {
        description: 'Durable journal identity for this AgentExecution.'
    }),
    ownerEntity: AgentExecutionOwnerEntitySchema.clone().register(field, {
        description: 'Canonical Entity type that owns the AgentExecution journal.'
    }),
    ownerId: IdSchema.clone().register(field, {
        description: 'Canonical id of the Entity that owns the AgentExecution journal.'
    }),
    agentExecutionId: IdSchema.clone().register(field, {
        description: 'AgentExecution identity associated with this journal.'
    }),
    recordCount: z.number().int().nonnegative().default(0).register(field, {
        description: 'Number of durable journal records currently known.'
    }),
    lastSequence: z.number().int().nonnegative().default(0).register(field, {
        description: 'Last durable journal record sequence currently known.'
    }),
    storageKey: IdSchema.clone().optional().register(field, {
        optional: true,
        description: 'Optional backend storage key for the durable journal.'
    })
}).strict();

export const AgentExecutionJournalRecordKindSchema = z.enum([
    'message.accepted',
    'process.started',
    'process.completed',
    'process.failed',
    'process.terminated',
    'process.output'
]);

export const AgentExecutionJournalRecordPayloadSchema = z.record(z.string(), z.unknown());

export const AgentExecutionJournalRecordStorageSchema = EntityStorageSchema.extend({
    id: EntityIdSchema.clone().register(field, {
        description: 'Canonical Entity id for the AgentExecution journal record.'
    }),
    journalId: IdSchema.clone().register(field, {
        description: 'Journal identity that owns this ordered record.'
    }),
    ownerEntity: AgentExecutionOwnerEntitySchema.clone().register(field, {
        description: 'Canonical Entity type that owns this AgentExecution journal.'
    }),
    ownerId: IdSchema.clone().register(field, {
        description: 'Canonical id of the Entity that owns this AgentExecution journal.'
    }),
    agentExecutionId: IdSchema.clone().register(field, {
        description: 'AgentExecution identity associated with this journal record.'
    }),
    sequence: z.number().int().positive().register(field, {
        description: 'One-based sequence number within the AgentExecution journal.'
    }),
    kind: AgentExecutionJournalRecordKindSchema.clone().register(field, {
        description: 'Semantic kind of AgentExecution journal record.'
    }),
    occurredAt: z.string().trim().min(1).register(field, {
        description: 'Timestamp when the recorded AgentExecution fact occurred.'
    }),
    summary: z.string().trim().min(1).optional().register(field, {
        optional: true,
        description: 'Short human-readable summary of the journal record.'
    }),
    payload: AgentExecutionJournalRecordPayloadSchema.optional().register(field, {
        type: 'object',
        optional: true,
        flexible: true,
        description: 'Structured payload for the journal record.'
    })
}).strict().register(table, {
    table: agentExecutionJournalTableName,
    schemafull: true,
    description: 'Ordered durable AgentExecution journal records.',
    indexes: [
        {
            name: 'agent_execution_journal_sequence_idx',
            fields: ['journalId', 'sequence'],
            unique: true
        },
        {
            name: 'agent_execution_journal_execution_time_idx',
            fields: ['agentExecutionId', 'occurredAt']
        },
        {
            name: 'agent_execution_journal_kind_idx',
            fields: ['kind']
        }
    ]
});

export const AgentExecutionJournalRecordInputSchema = z.object({
    kind: AgentExecutionJournalRecordKindSchema,
    occurredAt: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    payload: AgentExecutionJournalRecordPayloadSchema.optional()
}).strict();

export const AgentExecutionRetryLineageSchema = z.object({
    retryOfAgentExecutionId: IdSchema.clone().optional().register(field, {
        optional: true,
        description: 'AgentExecution identity retried by this execution.'
    }),
    retryAttempt: z.number().int().positive().optional().register(field, {
        optional: true,
        description: 'Retry attempt number for this AgentExecution.'
    })
}).strict();

export const AgentExecutionStorageSchema = EntityStorageSchema.extend({
    id: EntityIdSchema.clone().register(field, {
        description: 'Canonical Entity id for the AgentExecution storage record.'
    }),
    agentExecutionId: IdSchema.clone().register(field, {
        description: 'Daemon-issued AgentExecution identity inside the owner scope.'
    }),
    ownerEntity: AgentExecutionOwnerEntitySchema.clone().register(field, {
        description: 'Canonical Entity type that owns this AgentExecution.'
    }),
    ownerId: IdSchema.clone().register(field, {
        description: 'Canonical id of the owning Entity.'
    }),
    agentId: IdSchema.clone().register(field, {
        description: 'Selected Agent id for this AgentExecution.'
    }),
    lifecycle: AgentExecutionLifecycleStateSchema.clone().register(field, {
        description: 'Daemon-owned lifecycle state.'
    }),
    attention: AgentExecutionAttentionStateSchema.clone().register(field, {
        description: 'Current collaboration attention state.'
    }),
    activity: AgentExecutionActivityStateSchema.clone().register(field, {
        description: 'Current semantic work posture.'
    }),
    messageRegistry: AgentExecutionMessageRegistrySchema.register(field, {
        description: 'Current structured AgentExecution message registry.'
    }),
    transportState: AgentExecutionTransportStateSchema.register(field, {
        description: 'Minimal current structured transport state.'
    }),
    mcpAvailability: AgentExecutionMcpAvailabilitySchema.register(field, {
        description: 'Effective MCP-backed semantic operation availability.'
    }),
    journal: AgentExecutionJournalReferenceSchema.register(field, {
        description: 'Durable AgentExecution journal reference.'
    }),
    lineage: AgentExecutionRetryLineageSchema.optional().register(field, {
        optional: true,
        description: 'Retry lineage when this execution was created from another AgentExecution.'
    }),
    createdAt: z.string().trim().min(1).register(field, {
        description: 'AgentExecution creation timestamp.'
    }),
    updatedAt: z.string().trim().min(1).register(field, {
        description: 'AgentExecution last update timestamp.'
    })
}).strict().register(table, {
    table: agentExecutionTableName,
    schemafull: true,
    description: 'Canonical AgentExecution storage records.',
    indexes: [
        {
            name: 'agent_execution_owner_identity_idx',
            fields: ['ownerEntity', 'ownerId', 'agentExecutionId'],
            unique: true
        },
        {
            name: 'agent_execution_owner_updated_idx',
            fields: ['ownerEntity', 'ownerId', 'updatedAt']
        },
        {
            name: 'agent_execution_lifecycle_idx',
            fields: ['lifecycle']
        },
        {
            name: 'agent_execution_journal_idx',
            fields: ['journal.journalId'],
            unique: true
        }
    ]
});

const AgentExecutionStoragePayloadSchema = AgentExecutionStorageSchema.omit({ id: true });

export const AgentExecutionSchema = EntitySchema.extend({
    ...AgentExecutionStoragePayloadSchema.shape
}).strict();

export const AgentExecutionInputSchema = z.object({
    ownerEntity: AgentExecutionOwnerEntitySchema,
    ownerId: IdSchema,
    agentId: IdSchema,
    agentExecutionId: IdSchema.optional(),
    messageRegistry: AgentExecutionMessageRegistrySchema.default({ messages: [] }),
    transportState: AgentExecutionTransportStateSchema.default({
        status: 'unavailable',
        structuredTransport: 'none'
    }),
    mcpAvailability: AgentExecutionMcpAvailabilitySchema.default('unavailable'),
    journal: AgentExecutionJournalReferenceSchema.optional(),
    lineage: AgentExecutionRetryLineageSchema.optional()
}).strict();

export const AgentExecutionLocatorSchema = z.object({
    id: EntityIdSchema.optional(),
    ownerEntity: AgentExecutionOwnerEntitySchema.optional(),
    ownerId: IdSchema.optional(),
    agentExecutionId: IdSchema.optional()
}).strict().superRefine((value, context) => {
    if (value.id) {
        return;
    }
    if (value.ownerEntity && value.ownerId && value.agentExecutionId) {
        return;
    }
    context.addIssue({
        code: 'custom',
        message: 'AgentExecution locator requires either id or ownerEntity, ownerId, and agentExecutionId.'
    });
});

export const AgentExecutionSendMessageSourceSchema = z.enum([
    'operator',
    'daemon',
    'system',
    'owner'
]);

export const AgentExecutionMessageInputSchema = z.object({
    kind: z.string().trim().min(1),
    payload: z.unknown().optional(),
    messageId: IdSchema.optional(),
    source: AgentExecutionSendMessageSourceSchema.default('operator'),
    startsTurn: z.boolean().optional()
}).strict();

export const AgentExecutionSendMessageInputSchema = z.object({
    message: AgentExecutionMessageInputSchema
}).strict();

export const AgentExecutionSendMessageAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    agentExecutionId: IdSchema,
    messageId: IdSchema,
    accepted: z.literal(true)
}).strict();

export const AgentExecutionJournalPathSchema = z.string().trim().min(1);

export const AgentExecutionTerminalRecordingPathSchema = z.string().trim().min(1);

export const AgentExecutionTerminalHandleSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTransportReferenceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('terminal'),
        terminalName: z.string().trim().min(1),
        terminalPaneId: z.string().trim().min(1).optional()
    }).strict()
]);

export const AgentPromptSourceSchema = z.enum(['operator', 'system', 'engine']);

export const AgentPromptSchema = z.object({
    source: AgentPromptSourceSchema,
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
}).strict();

export const AgentCommandTypeSchema = z.enum(['interrupt', 'resume', 'checkpoint', 'nudge']);

export const AgentCommandSchema = z.object({
    type: AgentCommandTypeSchema
}).strict();

export const AgentExecutionResumeSchema = z.object({
    mode: z.enum(['new', 'resume'])
}).strict();

export const AgentLaunchSpecificationDocumentSchema = z.object({
    path: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    content: z.string().optional()
}).strict();

export const AgentLaunchSpecificationSchema = z.object({
    summary: z.string().trim().min(1),
    documents: z.array(AgentLaunchSpecificationDocumentSchema)
}).strict();

export const AgentExecutionScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('system') }).strict(),
    z.object({ kind: z.literal('repository'), repositoryRootPath: z.string().trim().min(1).optional() }).strict(),
    z.object({ kind: z.literal('mission'), missionId: IdSchema }).strict(),
    z.object({ kind: z.literal('task'), missionId: IdSchema, taskId: IdSchema, stageId: IdSchema.optional() }).strict(),
    z.object({ kind: z.literal('artifact'), artifactId: IdSchema, missionId: IdSchema.optional(), taskId: IdSchema.optional() }).strict()
]);

export const AgentLaunchConfigSchema = z.object({
    ownerId: IdSchema.optional(),
    scope: AgentExecutionScopeSchema,
    workingDirectory: z.string().trim().min(1),
    specification: AgentLaunchSpecificationSchema,
    requestedAdapterId: IdSchema.optional(),
    agentId: IdSchema.optional(),
    resume: AgentExecutionResumeSchema,
    initialPrompt: AgentPromptSchema,
    metadata: z.record(z.string(), z.unknown()).optional()
}).strict();

export const AgentExecutionReferenceSchema = z.object({
    agentId: IdSchema,
    agentExecutionId: IdSchema,
    transport: AgentExecutionTransportReferenceSchema.optional()
}).strict();

export const AgentExecutionLaunchRequestSchema = z.object({
    agentId: IdSchema,
    taskId: IdSchema.optional(),
    transportId: z.string().trim().min(1).optional(),
    prompt: z.string(),
    title: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: AgentExecutionReasoningEffortSchema.optional(),
    terminalName: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionObservationAddressSchema = z.object({
    ownerId: IdSchema,
    agentExecutionId: IdSchema
}).strict();

export const AgentExecutionObservationSchema = z.object({
    kind: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    payload: z.record(z.string(), z.unknown()).optional()
}).strict();

export const AgentExecutionSignalDecisionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('accept') }).strict(),
    z.object({ action: z.literal('pause') }).strict(),
    z.object({ action: z.literal('reject'), reason: z.string().trim().min(1).optional() }).strict()
]);

export const AgentExecutionEventSubjectSchema = AgentExecutionLocatorSchema.extend({
    entity: z.literal(agentExecutionEntityName)
}).strict();

export const AgentExecutionChangedSchema = z.object({
    reference: AgentExecutionEventSubjectSchema,
    data: AgentExecutionSchema
}).strict();

export const AgentExecutionTerminalSchema = z.object({
    reference: AgentExecutionEventSubjectSchema,
    terminalHandle: AgentExecutionTerminalHandleSchema.optional(),
    chunk: z.string().optional(),
    screen: z.string().optional(),
    connected: z.boolean().optional(),
    dead: z.boolean().optional(),
    exitCode: z.number().int().nullable().optional()
}).strict();

export const AgentExecutionDataChangedEventSchema = z.object({
    type: z.literal('data.changed'),
    data: AgentExecutionSchema
}).strict();

export const AgentExecutionTerminalEventSchema = z.object({
    type: z.literal('terminal'),
    data: AgentExecutionTerminalSchema
}).strict();

export type AgentExecutionConsoleStateType = {
    title?: string | undefined;
    lines: string[];
    promptOptions: string[] | null;
    awaitingInput: boolean;
    agentId?: string | undefined;
    adapterLabel?: string | undefined;
    agentExecutionId?: string | undefined;
};

export type AgentExecutionConsoleEventType =
    | {
        type: 'lines';
        lines: string[];
        state: AgentExecutionConsoleStateType;
    }
    | {
        type: 'state.changed';
        state: AgentExecutionConsoleStateType;
    };

export type AgentExecutionIdType = z.infer<typeof IdSchema>;
export type AgentExecutionOwnerEntityType = z.infer<typeof AgentExecutionOwnerEntitySchema>;
export type AgentExecutionOwnerReferenceType = z.infer<typeof AgentExecutionOwnerReferenceSchema>;
export type AgentExecutionLaunchModeType = z.infer<typeof AgentExecutionLaunchModeSchema>;
export type AgentExecutionReasoningEffortType = z.infer<typeof AgentExecutionReasoningEffortSchema>;
export type AgentExecutionLifecycleStateType = z.infer<typeof AgentExecutionLifecycleStateSchema>;
export type AgentExecutionAttentionStateType = z.infer<typeof AgentExecutionAttentionStateSchema>;
export type AgentExecutionActivityStateType = z.infer<typeof AgentExecutionActivityStateSchema>;
export type AgentExecutionMessageDirectionType = z.infer<typeof AgentExecutionMessageDirectionSchema>;
export type AgentExecutionMessageDeliveryType = z.infer<typeof AgentExecutionMessageDeliverySchema>;
export type AgentExecutionCommandPortabilityType = z.infer<typeof AgentExecutionCommandPortabilitySchema>;
export type AgentExecutionJournalEffectType = z.infer<typeof AgentExecutionJournalEffectSchema>;
export type AgentExecutionMessageDescriptorType = z.infer<typeof AgentExecutionMessageDescriptorSchema>;
export type AgentExecutionMessageRegistryType = z.infer<typeof AgentExecutionMessageRegistrySchema>;
export type AgentExecutionStructuredTransportType = z.infer<typeof AgentExecutionStructuredTransportSchema>;
export type AgentExecutionTransportStatusType = z.infer<typeof AgentExecutionTransportStatusSchema>;
export type AgentExecutionTransportStateType = z.infer<typeof AgentExecutionTransportStateSchema>;
export type AgentExecutionMcpAvailabilityType = z.infer<typeof AgentExecutionMcpAvailabilitySchema>;
export type AgentExecutionJournalReferenceType = z.infer<typeof AgentExecutionJournalReferenceSchema>;
export type AgentExecutionJournalRecordKindType = z.infer<typeof AgentExecutionJournalRecordKindSchema>;
export type AgentExecutionJournalRecordPayloadType = z.infer<typeof AgentExecutionJournalRecordPayloadSchema>;
export type AgentExecutionJournalRecordStorageType = z.infer<typeof AgentExecutionJournalRecordStorageSchema>;
export type AgentExecutionJournalRecordInputType = z.input<typeof AgentExecutionJournalRecordInputSchema>;
export type AgentExecutionRetryLineageType = z.infer<typeof AgentExecutionRetryLineageSchema>;
export type AgentExecutionStorageType = z.infer<typeof AgentExecutionStorageSchema>;
export type AgentExecutionType = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionInputType = z.input<typeof AgentExecutionInputSchema>;
export type AgentExecutionLocatorType = z.infer<typeof AgentExecutionLocatorSchema>;
export type AgentExecutionSendMessageSourceType = z.infer<typeof AgentExecutionSendMessageSourceSchema>;
export type AgentExecutionMessageInputType = z.infer<typeof AgentExecutionMessageInputSchema>;
export type AgentExecutionSendMessageInputType = z.infer<typeof AgentExecutionSendMessageInputSchema>;
export type AgentExecutionSendMessageAcknowledgementType = z.infer<typeof AgentExecutionSendMessageAcknowledgementSchema>;
export type AgentExecutionDataChangedEventType = z.infer<typeof AgentExecutionDataChangedEventSchema>;
export type AgentExecutionTerminalEventType = z.infer<typeof AgentExecutionTerminalEventSchema>;
export type AgentExecutionJournalPathType = z.infer<typeof AgentExecutionJournalPathSchema>;
export type AgentExecutionTerminalRecordingPathType = z.infer<typeof AgentExecutionTerminalRecordingPathSchema>;
export type AgentExecutionTerminalHandleType = z.infer<typeof AgentExecutionTerminalHandleSchema>;
export type AgentExecutionTransportReferenceType = z.infer<typeof AgentExecutionTransportReferenceSchema>;
export type AgentExecutionId = AgentExecutionIdType;
export type AgentPromptSourceType = z.infer<typeof AgentPromptSourceSchema>;
export type AgentPrompt = z.infer<typeof AgentPromptSchema>;
export type AgentCommandType = z.infer<typeof AgentCommandTypeSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type AgentExecutionResumeType = z.infer<typeof AgentExecutionResumeSchema>;
export type AgentLaunchSpecificationDocumentType = z.infer<typeof AgentLaunchSpecificationDocumentSchema>;
export type AgentLaunchSpecificationType = z.infer<typeof AgentLaunchSpecificationSchema>;
export type AgentExecutionScopeType = z.infer<typeof AgentExecutionScopeSchema>;
export type AgentLaunchConfig = z.infer<typeof AgentLaunchConfigSchema>;
export type AgentExecutionReference = z.infer<typeof AgentExecutionReferenceSchema>;
export type AgentExecutionLaunchRequestType = z.infer<typeof AgentExecutionLaunchRequestSchema>;
export type AgentExecutionObservationAddress = z.infer<typeof AgentExecutionObservationAddressSchema>;
export type AgentExecutionObservation = z.infer<typeof AgentExecutionObservationSchema>;
export type AgentExecutionSignalDecision = z.infer<typeof AgentExecutionSignalDecisionSchema>;
export type AgentExecutionEventSubjectType = z.infer<typeof AgentExecutionEventSubjectSchema>;
export type AgentExecutionChangedType = z.infer<typeof AgentExecutionChangedSchema>;
export type AgentExecutionTerminalType = z.infer<typeof AgentExecutionTerminalSchema>;
export type AgentExecutionPermissionRequestType = never;
export type AgentExecutionTelemetryType = never;

export const AgentExecutionCommandIds = {
    cancel: 'agentExecution.cancel'
} as const;

export function isTerminalFinalStatus(status: AgentExecutionLifecycleStateType): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'terminated';
}