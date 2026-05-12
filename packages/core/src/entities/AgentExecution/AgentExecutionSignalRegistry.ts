import { z } from 'zod/v4';
import {
    AgentBlockedSignalPayloadSchema,
    AgentCompletedClaimSignalPayloadSchema,
    AgentFailedClaimSignalPayloadSchema,
    AgentSignalArtifactReferenceSchema,
    AgentMessageSignalPayloadSchema,
    AgentNeedsInputSignalPayloadSchema,
    AgentProgressSignalPayloadSchema,
    AgentReadyForVerificationSignalPayloadSchema,
    AgentSignalDescriptorSchema,
    AgentSignalInputChoiceSchema,
    AgentStatusSignalPayloadSchema,
    AgentExecutionTimelineItemSchema,
    MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
    MAX_AGENT_EXECUTION_USAGE_ENTRIES,
    type AgentSignalDescriptorType,
    type AgentSignalInputChoiceType,
    type AgentExecutionTimelineItemType,
    type AgentExecutionTimelineProvenanceType
} from './AgentExecutionSchema.js';

const journalSignalTextSchema = z.string().trim().min(1).max(MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH);
const journalSignalPayloadValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const AgentExecutionJournalSignalSourceSchema = z.enum([
    'daemon-authoritative',
    'provider-structured',
    'agent-signal',
    'terminal-heuristic'
]);

export const AgentExecutionJournalSignalConfidenceSchema = z.enum([
    'authoritative',
    'high',
    'medium',
    'low',
    'diagnostic'
]);

export const AgentExecutionJournalInputChoiceSchema = AgentSignalInputChoiceSchema;

type ProjectableObservationSignal = {
    type: string;
};

type AgentExecutionSignalRegistryEntry = {
    type: string;
    descriptor?: AgentSignalDescriptorType;
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

const progressJournalSignalSchema = AgentProgressSignalPayloadSchema.extend(signalSourceFields).strict();
const statusJournalSignalSchema = AgentStatusSignalPayloadSchema.extend(signalSourceFields).strict();
const needsInputJournalSignalSchema = AgentNeedsInputSignalPayloadSchema.extend(signalSourceFields).strict();
const blockedJournalSignalSchema = AgentBlockedSignalPayloadSchema.extend(signalSourceFields).strict();
const readyForVerificationJournalSignalSchema = AgentReadyForVerificationSignalPayloadSchema.extend(signalSourceFields).strict();
const completedClaimJournalSignalSchema = AgentCompletedClaimSignalPayloadSchema.extend(signalSourceFields).strict();
const failedClaimJournalSignalSchema = AgentFailedClaimSignalPayloadSchema.extend(signalSourceFields).strict();
const messageJournalSignalSchema = AgentMessageSignalPayloadSchema.extend(signalSourceFields).strict();
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
        'agent-signal-malformed',
        'agent-signal-oversized',
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

function cloneInputChoices(choices: AgentSignalInputChoiceType[]): AgentSignalInputChoiceType[] {
    return choices.map((choice) => ({ ...choice }));
}

function cloneArtifactReferences(artifacts: z.infer<typeof AgentSignalArtifactReferenceSchema>[]): z.infer<typeof AgentSignalArtifactReferenceSchema>[] {
    return artifacts.map((artifact) => ({ ...artifact }));
}

type ArtifactActivityType = NonNullable<z.infer<typeof AgentSignalArtifactReferenceSchema>['activity']>;

type ArtifactTimelineSemantics = {
    title: string;
    primitive?: AgentExecutionTimelineItemType['primitive'];
    behaviorClass?: AgentExecutionTimelineItemType['behavior']['class'];
    zone?: AgentExecutionTimelineItemType['zone'];
};

type DerivedToolCallActivity = 'read' | 'edit' | 'write';

function firstArtifactActivity(signal: { artifacts?: z.infer<typeof AgentSignalArtifactReferenceSchema>[] | undefined }): ArtifactActivityType | undefined {
    return signal.artifacts?.find((artifact) => artifact.activity)?.activity;
}

function artifactTitle(activity: ArtifactActivityType, artifactCount: number, signalType: 'progress' | 'message'): string {
    const pluralSuffix = artifactCount === 1 ? '' : 's';

    if (signalType === 'progress') {
        switch (activity) {
            case 'read':
                return `Reading artifact${pluralSuffix}`;
            case 'edit':
                return `Editing artifact${pluralSuffix}`;
            case 'write':
                return `Writing artifact${pluralSuffix}`;
            case 'reference':
                return `Referencing artifact${pluralSuffix}`;
            case 'output':
                return `Producing artifact${pluralSuffix}`;
        }
    }

    switch (activity) {
        case 'read':
            return `Investigated artifact${pluralSuffix}`;
        case 'edit':
            return `Edited artifact${pluralSuffix}`;
        case 'write':
            return `Updated artifact${pluralSuffix}`;
        case 'reference':
            return `Referenced artifact${pluralSuffix}`;
        case 'output':
            return `Produced artifact${pluralSuffix}`;
    }
}

function resolveArtifactTimelineSemantics(
    signal: { artifacts?: z.infer<typeof AgentSignalArtifactReferenceSchema>[] | undefined },
    signalType: 'progress' | 'message'
): ArtifactTimelineSemantics | undefined {
    const activity = firstArtifactActivity(signal);
    const artifactCount = signal.artifacts?.length ?? 0;

    if (!activity || artifactCount === 0) {
        return undefined;
    }

    if (signalType === 'message' && activity === 'write') {
        return {
            title: artifactTitle(activity, artifactCount, signalType),
            primitive: 'artifact.updated',
            behaviorClass: 'artifact',
            zone: 'activity'
        };
    }

    return {
        title: artifactTitle(activity, artifactCount, signalType)
    };
}

function toTimelineArtifactPayload(signal: { artifacts?: z.infer<typeof AgentSignalArtifactReferenceSchema>[] | undefined }): {
    artifactId?: string;
    path?: string;
    artifacts?: z.infer<typeof AgentSignalArtifactReferenceSchema>[];
} {
    if (!signal.artifacts || signal.artifacts.length === 0) {
        return {};
    }

    const [primaryArtifact] = signal.artifacts;
    return {
        ...(primaryArtifact?.artifactId ? { artifactId: primaryArtifact.artifactId } : {}),
        ...(primaryArtifact?.path ? { path: primaryArtifact.path } : {}),
        artifacts: cloneArtifactReferences(signal.artifacts)
    };
}

function artifactActivityTitle(activity: DerivedToolCallActivity): string {
    switch (activity) {
        case 'read':
            return 'Reading artifact';
        case 'edit':
            return 'Editing artifact';
        case 'write':
            return 'Writing artifact';
    }
}

function deriveToolCallArtifacts(signal: z.infer<typeof diagnosticJournalSignalSchema>): {
    activity?: DerivedToolCallActivity;
    artifacts?: z.infer<typeof AgentSignalArtifactReferenceSchema>[];
    currentTarget?: AgentExecutionTimelineItemType['payload']['currentTarget'];
    activeToolName?: string;
    text?: string;
} {
    if (signal.code !== 'tool-call') {
        return {};
    }

    const toolName = typeof signal.payload?.['toolName'] === 'string' ? signal.payload['toolName'] : undefined;
    const args = typeof signal.payload?.['args'] === 'string' ? signal.payload['args'].trim() : undefined;
    const normalizedToolName = toolName?.trim().toLowerCase();
    const normalizedArgs = args && !args.startsWith('{') ? args : undefined;

    if (!normalizedToolName) {
        return {};
    }

    const activity = normalizedToolName === 'read_file'
        ? 'read'
        : normalizedToolName === 'edit_file'
            ? 'edit'
            : normalizedToolName === 'create_file'
                ? 'write'
                : undefined;

    const activeToolName = normalizedToolName.replace(/_/gu, ' ');
    const currentTarget: AgentExecutionTimelineItemType['payload']['currentTarget'] | undefined = normalizedArgs
        ? {
            kind: normalizedToolName === 'list_dir' ? 'artifact' : 'file',
            path: normalizedArgs,
            label: normalizedArgs.split('/').at(-1) ?? normalizedArgs
        }
        : undefined;

    if (!activity || !normalizedArgs) {
        return {
            ...(currentTarget ? { currentTarget } : {}),
            activeToolName,
            text: signal.summary
        };
    }

    return {
        activity,
        artifacts: [{ path: normalizedArgs, activity }],
        currentTarget,
        activeToolName,
        text: signal.summary
    };
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
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'progress',
            label: 'Progress',
            description: 'Reports current Agent execution progress for owner review.',
            icon: 'lucide:activity',
            tone: 'progress',
            payloadSchemaKey: 'agent-signal.progress.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'progress',
            outcomes: ['agent-execution-state', 'agent-execution-event']
        }),
        journalSchema: progressJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const progress = signal as z.infer<typeof AgentProgressSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            const artifactSemantics = resolveArtifactTimelineSemantics(progress, 'progress');
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: 'activity',
                primitive: 'activity.progress',
                behavior: createBehavior('live-activity', { compactable: true }),
                provenance,
                payload: {
                    title: artifactSemantics?.title ?? 'Progress',
                    text: progress.summary,
                    summary: progress.summary,
                    ...(progress.detail ? { detail: progress.detail } : {}),
                    ...toTimelineArtifactPayload(progress)
                }
            });
        }
    },
    {
        type: 'status',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'status',
            label: 'Status',
            description: 'Reports a machine-readable Agent execution status phase such as initializing or idle.',
            icon: 'lucide:circle-dot',
            tone: 'neutral',
            payloadSchemaKey: 'agent-signal.status.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'progress',
            outcomes: ['agent-execution-state', 'agent-execution-event']
        }),
        journalSchema: statusJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const status = signal as z.infer<typeof AgentStatusSignalPayloadSchema> & {
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
                    summary: text,
                    ...toTimelineArtifactPayload(status)
                }
            });
        }
    },
    {
        type: 'needs_input',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'needs_input',
            label: 'Needs Input',
            description: 'Requests operator or owner input before the Agent execution can continue, with fixed choices or a manual input choice.',
            icon: 'lucide:message-circle-question',
            tone: 'attention',
            payloadSchemaKey: 'agent-signal.needs-input.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'input-request',
            outcomes: ['agent-execution-state', 'owner-entity-event']
        }),
        journalSchema: needsInputJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const needsInput = signal as z.infer<typeof AgentNeedsInputSignalPayloadSchema> & {
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
                    choices: cloneInputChoices(needsInput.choices),
                    ...toTimelineArtifactPayload(needsInput)
                }
            });
        }
    },
    {
        type: 'blocked',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'blocked',
            label: 'Blocked',
            description: 'Declares that the Agent execution is blocked on a specific condition.',
            icon: 'lucide:octagon-alert',
            tone: 'danger',
            payloadSchemaKey: 'agent-signal.blocked.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-state', 'owner-entity-event']
        }),
        journalSchema: blockedJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const blocked = signal as z.infer<typeof AgentBlockedSignalPayloadSchema> & {
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
                    text: blocked.reason,
                    ...toTimelineArtifactPayload(blocked)
                }
            });
        }
    },
    {
        type: 'ready_for_verification',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'ready_for_verification',
            label: 'Ready For Verification',
            description: 'Claims that the owner can begin verification.',
            icon: 'lucide:badge-check',
            tone: 'success',
            payloadSchemaKey: 'agent-signal.ready-for-verification.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
        }),
        journalSchema: readyForVerificationJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const ready = signal as z.infer<typeof AgentReadyForVerificationSignalPayloadSchema> & {
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
                    text: ready.summary,
                    ...toTimelineArtifactPayload(ready)
                }
            });
        }
    },
    {
        type: 'completed_claim',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'completed_claim',
            label: 'Completed Claim',
            description: 'Claims the scoped work is complete for owner evaluation.',
            icon: 'lucide:check-check',
            tone: 'success',
            payloadSchemaKey: 'agent-signal.completed-claim.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-event', 'owner-entity-event', 'workflow-event']
        }),
        journalSchema: completedClaimJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const completed = signal as z.infer<typeof AgentCompletedClaimSignalPayloadSchema> & {
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
                    result: 'passed',
                    ...toTimelineArtifactPayload(completed)
                }
            });
        }
    },
    {
        type: 'failed_claim',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'failed_claim',
            label: 'Failed Claim',
            description: 'Claims the scoped work failed for owner evaluation.',
            icon: 'lucide:circle-x',
            tone: 'danger',
            payloadSchemaKey: 'agent-signal.failed-claim.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'claim',
            outcomes: ['agent-execution-state', 'agent-execution-event', 'owner-entity-event']
        }),
        journalSchema: failedClaimJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const failed = signal as z.infer<typeof AgentFailedClaimSignalPayloadSchema> & {
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
                    result: 'failed',
                    ...toTimelineArtifactPayload(failed)
                }
            });
        }
    },
    {
        type: 'message',
        descriptor: AgentSignalDescriptorSchema.parse({
            type: 'message',
            label: 'Message',
            description: 'Appends an audit-facing Agent execution message.',
            icon: 'lucide:message-square',
            tone: 'neutral',
            payloadSchemaKey: 'agent-signal.message.v1',
            deliveries: ['stdout-marker', 'mcp-tool'],
            policy: 'audit-message',
            outcomes: ['agent-execution-event']
        }),
        journalSchema: messageJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const message = signal as z.infer<typeof AgentMessageSignalPayloadSchema> & {
                source: z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
                confidence: z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
            };
            const artifactSemantics = resolveArtifactTimelineSemantics(message, 'message');
            return toTimelineItem({
                id: itemId,
                occurredAt,
                zone: artifactSemantics?.zone ?? 'conversation',
                primitive: artifactSemantics?.primitive ?? (message.channel === 'agent'
                    ? 'conversation.agent-message'
                    : 'conversation.system-message'),
                behavior: createBehavior(artifactSemantics?.behaviorClass ?? 'conversational'),
                provenance,
                payload: {
                    ...(artifactSemantics?.title ? { title: artifactSemantics.title } : {}),
                    text: message.text
                    ,
                    ...toTimelineArtifactPayload(message)
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
        journalSchema: diagnosticJournalSignalSchema,
        projectToTimelineItem: ({ itemId, occurredAt, signal, provenance }) => {
            const diagnostic = signal as z.infer<typeof diagnosticJournalSignalSchema>;
            if (diagnostic.code === 'tool-call') {
                const derived = deriveToolCallArtifacts(diagnostic);
                return toTimelineItem({
                    id: itemId,
                    occurredAt,
                    zone: 'activity',
                    primitive: 'activity.tool',
                    behavior: createBehavior('live-activity', { compactable: true }),
                    provenance,
                    payload: {
                        title: derived.activity ? artifactActivityTitle(derived.activity) : 'Tool activity',
                        ...(derived.text ? { text: derived.text } : { text: diagnostic.summary }),
                        ...(derived.activeToolName ? { activeToolName: derived.activeToolName } : {}),
                        ...(derived.currentTarget ? { currentTarget: derived.currentTarget } : {}),
                        ...(derived.artifacts?.[0]?.path ? { path: derived.artifacts[0].path } : {}),
                        ...(derived.artifacts ? { artifacts: derived.artifacts } : {})
                    }
                });
            }

            if (diagnostic.code === 'provider-execution') {
                return toTimelineItem({
                    id: itemId,
                    occurredAt,
                    zone: 'workflow',
                    primitive: 'workflow.event',
                    behavior: createBehavior('timeline-event', { compactable: true }),
                    provenance,
                    payload: {
                        title: 'Provider execution',
                        text: diagnostic.summary
                    }
                });
            }

            return undefined;
        }
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

export const baselineAgentSignalDescriptors: AgentSignalDescriptorType[] = AgentSignalDescriptorSchema
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

export function createAgentExecutionSignalFromPayload(
    payload: z.infer<
        typeof AgentProgressSignalPayloadSchema
        | typeof AgentStatusSignalPayloadSchema
        | typeof AgentNeedsInputSignalPayloadSchema
        | typeof AgentBlockedSignalPayloadSchema
        | typeof AgentReadyForVerificationSignalPayloadSchema
        | typeof AgentCompletedClaimSignalPayloadSchema
        | typeof AgentFailedClaimSignalPayloadSchema
        | typeof AgentMessageSignalPayloadSchema
    >
): z.infer<typeof AgentExecutionJournalSignalSchema> {
    switch (payload.type) {
        case 'progress':
            return {
                type: 'progress',
                summary: payload.summary,
                ...(payload.detail ? { detail: payload.detail } : {}),
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'status':
            return {
                type: 'status',
                phase: payload.phase,
                ...(payload.summary ? { summary: payload.summary } : {}),
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'needs_input':
            return {
                type: 'needs_input',
                question: payload.question,
                choices: cloneInputChoices(payload.choices),
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'blocked':
            return {
                type: 'blocked',
                reason: payload.reason,
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'ready_for_verification':
            return {
                type: 'ready_for_verification',
                summary: payload.summary,
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'completed_claim':
            return {
                type: 'completed_claim',
                summary: payload.summary,
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'failed_claim':
            return {
                type: 'failed_claim',
                reason: payload.reason,
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
        case 'message':
            return {
                type: 'message',
                channel: payload.channel,
                text: payload.text,
                ...(payload.artifacts ? { artifacts: cloneArtifactReferences(payload.artifacts) } : {}),
                source: 'agent-signal',
                confidence: 'medium'
            };
    }
}

export type AgentExecutionJournalSignalSourceType = z.infer<typeof AgentExecutionJournalSignalSourceSchema>;
export type AgentExecutionJournalSignalConfidenceType = z.infer<typeof AgentExecutionJournalSignalConfidenceSchema>;
export type AgentExecutionJournalInputChoiceType = AgentSignalInputChoiceType;
export type AgentExecutionJournalSignalType = z.infer<typeof AgentExecutionJournalSignalSchema>;