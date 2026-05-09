import { z } from 'zod/v4';
import {
    AgentDeclaredBlockedSignalPayloadSchema,
    AgentDeclaredCompletedClaimSignalPayloadSchema,
    AgentDeclaredFailedClaimSignalPayloadSchema,
    AgentDeclaredMessageSignalPayloadSchema,
    AgentDeclaredNeedsInputSignalPayloadSchema,
    AgentDeclaredProgressSignalPayloadSchema,
    AgentDeclaredReadyForVerificationSignalPayloadSchema,
    AgentDeclaredSignalDescriptorSchema,
    AgentDeclaredSignalInputChoiceSchema,
    AgentDeclaredStatusSignalPayloadSchema,
    AgentExecutionTimelineItemSchema,
    MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
    MAX_AGENT_EXECUTION_USAGE_ENTRIES,
    type AgentDeclaredSignalDescriptorType,
    type AgentDeclaredSignalInputChoiceType,
    type AgentExecutionTimelineItemType,
    type AgentExecutionTimelineProvenanceType
} from './AgentExecutionSchema.js';

const journalSignalTextSchema = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH);
const journalSignalPayloadValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const AgentExecutionJournalSignalSourceSchema = z.enum([
    'daemon-authoritative',
    'provider-structured',
    'agent-declared',
    'terminal-heuristic'
]);

export const AgentExecutionJournalSignalConfidenceSchema = z.enum([
    'authoritative',
    'high',
    'medium',
    'low',
    'diagnostic'
]);

export const AgentExecutionJournalInputChoiceSchema = AgentDeclaredSignalInputChoiceSchema;

type ProjectableObservationSignal = {
    type: string;
};

type AgentExecutionSignalRegistryEntry = {
    type: string;
    descriptor?: AgentDeclaredSignalDescriptorType;
    journalSchema: z.ZodTypeAny;
    projectToTimelineItem?: (input: {
        itemId: string;
        occurredAt: string;
        signal: ProjectableObservationSignal;
        provenance: AgentExecutionTimelineProvenanceType;
    }) => AgentExecutionTimelineItemType | undefined;
};

const signalSourceFields = {
    source: AgentExecutionJournalSignalSourceSchema,
    confidence: AgentExecutionJournalSignalConfidenceSchema
} as const;

const progressJournalSignalSchema = AgentDeclaredProgressSignalPayloadSchema.extend(signalSourceFields).strict();
const statusJournalSignalSchema = AgentDeclaredStatusSignalPayloadSchema.extend(signalSourceFields).strict();
const needsInputJournalSignalSchema = AgentDeclaredNeedsInputSignalPayloadSchema.extend(signalSourceFields).strict();
const blockedJournalSignalSchema = AgentDeclaredBlockedSignalPayloadSchema.extend(signalSourceFields).strict();
const readyForVerificationJournalSignalSchema = AgentDeclaredReadyForVerificationSignalPayloadSchema.extend(signalSourceFields).strict();
const completedClaimJournalSignalSchema = AgentDeclaredCompletedClaimSignalPayloadSchema.extend(signalSourceFields).strict();
const failedClaimJournalSignalSchema = AgentDeclaredFailedClaimSignalPayloadSchema.extend(signalSourceFields).strict();
const messageJournalSignalSchema = AgentDeclaredMessageSignalPayloadSchema.extend(signalSourceFields).strict();
const usageJournalSignalSchema = z.object({
    type: z.literal('usage'),
    payload: z.record(z.string(), journalSignalPayloadValueSchema)
        .refine((value) => Object.keys(value).length <= MAX_AGENT_EXECUTION_USAGE_ENTRIES, {
            message: `Usage payload must contain at most ${MAX_AGENT_EXECUTION_USAGE_ENTRIES} entries.`
        }),
    ...signalSourceFields
}).strict();
const diagnosticJournalSignalSchema = z.object({
    type: z.literal('diagnostic'),
    code: z.enum([
        'provider-execution',
        'tool-call',
        'agent-declared-signal-malformed',
        'agent-declared-signal-oversized',
        'terminal-heuristic'
    ]),
    summary: journalSignalTextSchema,
    detail: journalSignalTextSchema.optional(),
    payload: z.record(z.string(), journalSignalPayloadValueSchema).optional(),
    ...signalSourceFields
}).strict();

function createBehavior(behaviorClass: AgentExecutionTimelineItemType['behavior']['class'], overrides: Partial<AgentExecutionTimelineItemType['behavior']> = {}): AgentExecutionTimelineItemType['behavior'] {
    return {
        class: behaviorClass,
        compactable: false,
        collapsible: false,
        sticky: false,
        actionable: false,
        replayRelevant: true,
        transient: false,
        defaultExpanded: true,
        ...overrides
    };
}

function toTimelineItem(item: AgentExecutionTimelineItemType): AgentExecutionTimelineItemType {
    return AgentExecutionTimelineItemSchema.parse(item);
}

function cloneInputChoices(choices: AgentDeclaredSignalInputChoiceType[]): AgentDeclaredSignalInputChoiceType[] {
    return choices.map((choice) => ({ ...choice }));
}

function defaultStatusText(phase: 'initializing' | 'idle', summary?: string): string {
    if (summary) {
        return summary;
    }
    return phase === 'idle'
        ? 'Idle and ready for the next structured prompt.'
        : 'Initializing the next agent turn.';
}

const signalRegistryEntries = [
    {
        type: 'progress',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'progress',
            label: 'Progress',
            description: 'Reports current Agent execution progress for owner review.',
            icon: 'lucide:activity',
            tone: 'progress',
            payloadSchemaKey: 'agent-declared-signal.progress.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'progress',
            outcomes: ['agent-execution-state', 'agent-execution-event']
        }),
        journalSchema: progressJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const progress = signal as z.infer<typeof AgentDeclaredProgressSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'activity',
                primitive: 'activity.progress',
                behavior: createBehavior('live-activity', { compactable: true }),
                provenance,
                payload: {
                    title: 'Progress',
                    text: progress.summary,
                    summary: progress.summary,
                    ...(progress.detail ? { detail: progress.detail } : {})
                }
            });
        }
    },
    {
        type: 'status',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'status',
            label: 'Status',
            description: 'Reports a machine-readable Agent execution status phase such as initializing or idle.',
            icon: 'lucide:circle-dot',
            tone: 'neutral',
            payloadSchemaKey: 'agent-declared-signal.status.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'progress',
            outcomes: ['agent-execution-state', 'agent-execution-event']
        }),
        journalSchema: statusJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const status = signal as z.infer<typeof AgentDeclaredStatusSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            const text = defaultStatusText(status.phase, status.summary);
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'activity',
                primitive: 'activity.status',
                behavior: createBehavior('live-activity', { compactable: true, transient: true }),
                provenance,
                payload: {
                    title: status.phase === 'idle' ? 'Idle' : 'Initializing',
                    text,
                    summary: text
                }
            });
        }
    },
    {
        type: 'needs_input',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'needs_input',
            label: 'Needs Input',
            description: 'Requests operator or owner input before the Agent execution can continue, with fixed choices or a manual input choice.',
            icon: 'lucide:message-circle-question',
            tone: 'attention',
            payloadSchemaKey: 'agent-declared-signal.needs-input.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'input-request',
            outcomes: ['agent-execution-state', 'owner-entity-event']
        }),
        journalSchema: needsInputJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const needsInput = signal as z.infer<typeof AgentDeclaredNeedsInputSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'conversation',
                primitive: 'attention.input-request',
                behavior: createBehavior('approval', { sticky: true, actionable: true }),
                provenance,
                payload: {
                    title: 'Needs input',
                    text: needsInput.question,
                    choices: cloneInputChoices(needsInput.choices)
                }
            });
        }
    },
    {
        type: 'blocked',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'blocked',
            label: 'Blocked',
            description: 'Declares that the Agent execution is blocked on a specific condition.',
            icon: 'lucide:octagon-alert',
            tone: 'danger',
            payloadSchemaKey: 'agent-declared-signal.blocked.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-state', 'owner-entity-event']
        }),
        journalSchema: blockedJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const blocked = signal as z.infer<typeof AgentDeclaredBlockedSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'workflow',
                primitive: 'attention.blocked',
                behavior: createBehavior('approval', { sticky: true }),
                severity: 'warning',
                provenance,
                payload: {
                    title: 'Blocked',
                    text: blocked.reason
                }
            });
        }
    },
    {
        type: 'ready_for_verification',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'ready_for_verification',
            label: 'Ready For Verification',
            description: 'Claims that the owner can begin verification.',
            icon: 'lucide:badge-check',
            tone: 'success',
            payloadSchemaKey: 'agent-declared-signal.ready-for-verification.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
        }),
        journalSchema: readyForVerificationJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const ready = signal as z.infer<typeof AgentDeclaredReadyForVerificationSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'workflow',
                primitive: 'attention.verification-requested',
                behavior: createBehavior('approval', { sticky: true, actionable: true }),
                severity: 'info',
                provenance,
                payload: {
                    title: 'Ready for verification',
                    text: ready.summary
                }
            });
        }
    },
    {
        type: 'completed_claim',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'completed_claim',
            label: 'Completed Claim',
            description: 'Claims the scoped work is complete for owner evaluation.',
            icon: 'lucide:check-check',
            tone: 'success',
            payloadSchemaKey: 'agent-declared-signal.completed-claim.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
        }),
        journalSchema: completedClaimJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const completed = signal as z.infer<typeof AgentDeclaredCompletedClaimSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'workflow',
                primitive: 'attention.verification-result',
                behavior: createBehavior('approval'),
                severity: 'success',
                provenance,
                payload: {
                    title: 'Completed claim',
                    text: completed.summary,
                    result: 'passed'
                }
            });
        }
    },
    {
        type: 'failed_claim',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'failed_claim',
            label: 'Failed Claim',
            description: 'Claims the scoped work failed for owner evaluation.',
            icon: 'lucide:circle-x',
            tone: 'danger',
            payloadSchemaKey: 'agent-declared-signal.failed-claim.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-state', 'agent-execution-event', 'owner-entity-event']
        }),
        journalSchema: failedClaimJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const failed = signal as z.infer<typeof AgentDeclaredFailedClaimSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'workflow',
                primitive: 'attention.verification-result',
                behavior: createBehavior('approval', { sticky: true }),
                severity: 'error',
                provenance,
                payload: {
                    title: 'Failed claim',
                    text: failed.reason,
                    result: 'failed'
                }
            });
        }
    },
    {
        type: 'message',
        descriptor: AgentDeclaredSignalDescriptorSchema.parse({
            type: 'message',
            label: 'Message',
            description: 'Appends an audit-facing Agent execution message.',
            icon: 'lucide:message-square',
            tone: 'neutral',
            payloadSchemaKey: 'agent-declared-signal.message.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'audit-message',
            outcomes: ['agent-execution-event']
        }),
        journalSchema: messageJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const message = signal as z.infer<typeof AgentDeclaredMessageSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'conversation',
                primitive: message.channel === 'agent'
                    ? 'conversation.agent-message'
                    : 'conversation.system-message',
                behavior: createBehavior('conversational'),
                provenance,
                payload: {
                    text: message.text
                }
            });
        }
    },
    {
        type: 'usage',
        journalSchema: usageJournalSignalSchema
    },
    {
        type: 'diagnostic',
        journalSchema: diagnosticJournalSignalSchema
    }
] satisfies AgentExecutionSignalRegistryEntry[];

export const agentExecutionSignalRegistry = Object.freeze(Object.fromEntries(
    signalRegistryEntries.map((entry) => [entry.type, entry])
)) as Readonly<Record<string, AgentExecutionSignalRegistryEntry>>;

export const AgentExecutionJournalSignalSchema = z.discriminatedUnion(
    'type',
    [
        progressJournalSignalSchema,
        statusJournalSignalSchema,
        needsInputJournalSignalSchema,
        blockedJournalSignalSchema,
        readyForVerificationJournalSignalSchema,
        completedClaimJournalSignalSchema,
        failedClaimJournalSignalSchema,
        messageJournalSignalSchema,
        usageJournalSignalSchema,
        diagnosticJournalSignalSchema
    ]
);

export const baselineAgentDeclaredSignalDescriptors: AgentDeclaredSignalDescriptorType[] = AgentDeclaredSignalDescriptorSchema
    .array()
    .parse(signalRegistryEntries.flatMap((entry) => entry.descriptor ? [entry.descriptor] : []));

export function projectAgentExecutionObservationSignalToTimelineItem(input: {
    itemId: string;
    occurredAt: string;
    signal: z.infer<typeof AgentExecutionJournalSignalSchema>;
    provenance: AgentExecutionTimelineProvenanceType;
}): AgentExecutionTimelineItemType | undefined {
    const entry = agentExecutionSignalRegistry[input.signal.type];
    return entry?.projectToTimelineItem?.(input);
}

export function createAgentExecutionSignalFromDeclaredPayload(
    payload: z.infer<
        typeof AgentDeclaredProgressSignalPayloadSchema
        | typeof AgentDeclaredStatusSignalPayloadSchema
        | typeof AgentDeclaredNeedsInputSignalPayloadSchema
        | typeof AgentDeclaredBlockedSignalPayloadSchema
        | typeof AgentDeclaredReadyForVerificationSignalPayloadSchema
        | typeof AgentDeclaredCompletedClaimSignalPayloadSchema
        | typeof AgentDeclaredFailedClaimSignalPayloadSchema
        | typeof AgentDeclaredMessageSignalPayloadSchema
    >
): z.infer<typeof AgentExecutionJournalSignalSchema> {
    switch (payload.type) {
        case 'progress':
            return {
                type: 'progress',
                summary: payload.summary,
                ...(payload.detail ? { detail: payload.detail } : {}),
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'status':
            return {
                type: 'status',
                phase: payload.phase,
                ...(payload.summary ? { summary: payload.summary } : {}),
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'needs_input':
            return {
                type: 'needs_input',
                question: payload.question,
                choices: cloneInputChoices(payload.choices),
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'blocked':
            return {
                type: 'blocked',
                reason: payload.reason,
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'ready_for_verification':
            return {
                type: 'ready_for_verification',
                summary: payload.summary,
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'completed_claim':
            return {
                type: 'completed_claim',
                summary: payload.summary,
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'failed_claim':
            return {
                type: 'failed_claim',
                reason: payload.reason,
                source: 'agent-declared',
                confidence: 'medium'
            };
        case 'message':
            return {
                type: 'message',
                channel: payload.channel,
                text: payload.text,
                source: 'agent-declared',
                confidence: 'medium'
            };
    }
}

export type AgentExecutionJournalSignalSourceType = z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
export type AgentExecutionJournalSignalConfidenceType = z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
export type AgentExecutionJournalInputChoiceType = AgentDeclaredSignalInputChoiceType;
export type AgentExecutionJournalSignalType = z.infer<typeof AgentExecutionJournalSignalSchema>;