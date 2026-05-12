import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AgentExecutionScope, AgentLaunchConfig } from './AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionProtocolDescriptorType,
    AgentExecutionProtocolOwnerEntityType,
    AgentExecutionTransportStateType
} from './AgentExecutionSchema.js';
import type {
    AgentExecutionActivityUpdatedRecordType,
    AgentExecutionDecisionRecordType,
    AgentExecutionJournalHeaderRecordType,
    AgentExecutionJournalOriginType,
    AgentExecutionJournalReferenceType,
    AgentExecutionJournalRecordAuthorityType,
    AgentExecutionJournalRecordBaseType,
    AgentExecutionJournalExecutionContextType,
    AgentExecutionJournalRecordType,
    AgentExecutionJournalStore,
    AgentExecutionMessageAcceptedRecordType,
    AgentExecutionMessageDeliveryRecordType,
    AgentExecutionObservationRecordType,
    AgentExecutionRuntimeFactRecordType,
    AgentExecutionTransportEvidenceRecordType,
    AgentExecutionStateChangedRecordType
} from './AgentExecutionJournalSchema.js';
import { AgentExecutionJournalFileStore, type AgentExecutionJournalFileStorePath } from './AgentExecutionJournalFileStore.js';
import { Repository } from '../Repository/Repository.js';
import { getMissionDaemonDirectory } from '../../settings/MissionInstall.js';
import type {
    AgentCommand,
    AgentExecutionObservation,
    AgentExecutionSignalDecision,
    AgentPrompt
} from './AgentExecutionProtocolTypes.js';
import { deriveActivityStateFromProgressState } from './AgentExecutionRuntimeSemantics.js';

export type AgentExecutionJournalLaunchInput = {
    agentExecutionId: string;
    agentId: string;
    scope: AgentExecutionScope;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    workingDirectory?: string;
};

export type AgentExecutionJournalWriterOptions = {
    resolveReference?: (input: AgentExecutionJournalLaunchInput) => AgentExecutionJournalReferenceType;
    resolveStore?: (input: AgentExecutionJournalLaunchInput & {
        reference: AgentExecutionJournalReferenceType;
    }) => AgentExecutionJournalStore;
    createRecordId?: () => string;
    now?: () => string;
};

export class AgentExecutionJournalWriter {
    private readonly resolveReference: (input: AgentExecutionJournalLaunchInput) => AgentExecutionJournalReferenceType;
    private readonly resolveStore: (input: AgentExecutionJournalLaunchInput & {
        reference: AgentExecutionJournalReferenceType;
    }) => AgentExecutionJournalStore;
    private readonly createRecordId: () => string;
    private readonly now: () => string;
    private readonly journalStateById = new Map<string, JournalAppendState>();

    public constructor(options: AgentExecutionJournalWriterOptions = {}) {
        this.resolveReference = options.resolveReference ?? createAgentExecutionJournalReference;
        this.resolveStore = options.resolveStore ?? createFileBackedJournalStoreForLaunch;
        this.createRecordId = options.createRecordId ?? randomUUID;
        this.now = options.now ?? (() => new Date().toISOString());
    }

    public async ensureLaunchJournal(input: AgentExecutionJournalLaunchInput): Promise<AgentExecutionJournalReferenceType> {
        const { reference, store } = this.resolveJournalContext(input);
        await store.ensureJournal(reference);
        const headerRecord = this.createHeaderRecord(input, reference);
        await store.appendRecord(reference, headerRecord);
        this.journalStateById.set(reference.journalId, {
            reference,
            lastSequence: headerRecord.sequence,
            recordCount: 1,
            executionContextSeed: {
                agentAdapter: headerRecord.agentId,
                runtimeVersion: headerRecord.executionContext.daemon.runtimeVersion,
                protocolVersion: headerRecord.executionContext.daemon.protocolVersion
            }
        });
        return {
            ...reference,
            recordCount: 1,
            lastSequence: 0
        };
    }

    public async readRecords(input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>): Promise<AgentExecutionJournalRecordType[]> {
        const { reference, store } = this.resolveJournalContext(input);
        const records = await store.readRecords(reference);
        this.journalStateById.set(reference.journalId, buildJournalAppendState(reference, records));
        return records;
    }

    public async appendPromptAccepted(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        prompt: AgentPrompt;
    }): Promise<AgentExecutionMessageAcceptedRecordType> {
        const source = mapPromptSource(input.prompt.source);
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionMessageAcceptedRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'turn.accepted',
                family: 'turn.accepted',
                entrySemantics: 'event',
                authority: source === 'operator'
                    ? 'operator'
                    : source === 'system'
                        ? 'system'
                        : 'daemon',
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: source === 'operator'
                    ? 'operator'
                    : source === 'system'
                        ? 'system'
                        : 'daemon'
            }),
            messageId: context.recordId,
            source,
            messageType: 'prompt',
            payload: { text: input.prompt.text },
            mutatesContext: false
        }));
    }

    public async appendCommandAccepted(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        command: AgentCommand;
        source?: AgentExecutionMessageAcceptedRecordType['source'];
    }): Promise<AgentExecutionMessageAcceptedRecordType> {
        const source = input.source ?? 'operator';
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionMessageAcceptedRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'turn.accepted',
                family: 'turn.accepted',
                entrySemantics: 'event',
                authority: source,
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: source
            }),
            messageId: context.recordId,
            source,
            messageType: `command.${input.command.type}`,
            payload: { ...input.command },
            mutatesContext: false
        }));
    }

    public async appendMessageDelivery(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        messageId: string;
        status: AgentExecutionMessageDeliveryRecordType['status'];
        transport: AgentExecutionMessageDeliveryRecordType['transport'];
        reason?: string;
    }): Promise<AgentExecutionMessageDeliveryRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionMessageDeliveryRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'turn.delivery',
                family: 'turn.delivery',
                entrySemantics: 'event',
                authority: 'daemon',
                assertionLevel: input.status === 'failed' ? 'diagnostic' : 'informational',
                replayClass: 'replay-optional',
                origin: 'daemon'
            }),
            messageId: input.messageId,
            status: input.status,
            transport: input.transport,
            ...(input.reason ? { reason: input.reason } : {})
        }));
    }

    public async appendObservation(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        observation: AgentExecutionObservation;
    }): Promise<AgentExecutionObservationRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionObservationRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'agent-observation',
                family: 'agent-observation',
                entrySemantics: 'event',
                authority: mapObservationAuthority(input.observation),
                assertionLevel: mapObservationAssertionLevel(input.observation),
                replayClass: 'replay-critical',
                origin: mapObservationOrigin(input.observation)
            }),
            observationId: input.observation.observationId,
            source: mapObservationSource(input.observation),
            confidence: mapObservationConfidence(input.observation.signal.confidence),
            signal: cloneStructured(input.observation.signal),
            ...(input.observation.rawText ? { rawText: input.observation.rawText } : {})
        }));
    }

    public async appendRuntimeFact(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        factType: AgentExecutionRuntimeFactRecordType['factType'];
        path?: string;
        artifactId?: string;
        detail?: string;
        payload?: AgentExecutionRuntimeFactRecordType['payload'];
    }): Promise<AgentExecutionRuntimeFactRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionRuntimeFactRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'runtime-fact',
                family: 'runtime-fact',
                entrySemantics: 'event',
                authority: 'daemon',
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: 'daemon'
            }),
            factId: context.recordId,
            factType: input.factType,
            ...(input.path ? { path: input.path } : {}),
            ...(input.artifactId ? { artifactId: input.artifactId } : {}),
            ...(input.detail ? { detail: input.detail } : {}),
            ...(input.payload ? { payload: cloneStructured(input.payload) } : {})
        }));
    }

    public async appendTransportEvidence(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        evidenceType: AgentExecutionTransportEvidenceRecordType['evidenceType'];
        origin: AgentExecutionJournalOriginType;
        content?: string;
        payload?: AgentExecutionTransportEvidenceRecordType['payload'];
    }): Promise<AgentExecutionTransportEvidenceRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionTransportEvidenceRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'transport-evidence',
                family: 'transport-evidence',
                entrySemantics: 'evidence',
                authority: 'daemon',
                assertionLevel: 'diagnostic',
                replayClass: 'evidence-only',
                origin: input.origin
            }),
            evidenceId: context.recordId,
            evidenceType: input.evidenceType,
            ...(input.content ? { content: input.content } : {}),
            ...(input.payload ? { payload: cloneStructured(input.payload) } : {})
        }));
    }

    public async appendDecision(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        observationId?: string;
        messageId?: string;
        decision: AgentExecutionSignalDecision;
    }): Promise<AgentExecutionDecisionRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionDecisionRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'decision.recorded',
                family: 'decision.recorded',
                entrySemantics: 'event',
                authority: 'daemon',
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: 'daemon'
            }),
            decisionId: context.recordId,
            ...(input.observationId ? { observationId: input.observationId } : {}),
            ...(input.messageId ? { messageId: input.messageId } : {}),
            action: mapDecisionAction(input.decision),
            ...(readDecisionReason(input.decision) ? { reason: readDecisionReason(input.decision) } : {})
        }));
    }

    public async appendStateChanged(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        decision: Extract<AgentExecutionSignalDecision, { action: 'update-execution' }>;
        currentInputRequestId?: string | null;
        awaitingResponseToMessageId?: string | null;
    }): Promise<AgentExecutionStateChangedRecordType> {
        return this.appendExecutionStateChanged({
            agentExecutionId: input.agentExecutionId,
            scope: input.scope,
            lifecycle: mapStateChangedLifecycle(input.decision),
            attention: input.decision.snapshotPatch.attention,
            activity: input.decision.snapshotPatch.progress?.state
                ? deriveActivityStateFromProgressState(input.decision.snapshotPatch.progress.state)
                : undefined,
            ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
            ...(input.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: input.awaitingResponseToMessageId } : {})
        });
    }

    public async appendExecutionStateChanged(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        lifecycle?: AgentExecutionStateChangedRecordType['lifecycle'];
        attention?: AgentExecutionStateChangedRecordType['attention'];
        activity?: AgentExecutionStateChangedRecordType['activity'];
        currentInputRequestId?: string | null;
        awaitingResponseToMessageId?: string | null;
    }): Promise<AgentExecutionStateChangedRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionStateChangedRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'state.changed',
                family: 'state.changed',
                entrySemantics: 'event',
                authority: 'daemon',
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: 'daemon'
            }),
            ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
            ...(input.attention ? { attention: input.attention } : {}),
            ...(input.activity ? { activity: input.activity } : {}),
            ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
            ...(input.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: input.awaitingResponseToMessageId } : {})
        }));
    }

    public async appendActivityUpdated(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        decision: Extract<AgentExecutionSignalDecision, { action: 'update-execution' }>;
    }): Promise<AgentExecutionActivityUpdatedRecordType | undefined> {
        const progress = input.decision.snapshotPatch.progress;
        if (!progress) {
            return undefined;
        }
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase<AgentExecutionActivityUpdatedRecordType>(input, context.reference, context.sequence, context.recordId, context.existingRecords, context.executionContextSeed, {
                type: 'activity.updated',
                family: 'activity.updated',
                entrySemantics: 'snapshot',
                authority: 'daemon',
                assertionLevel: 'informational',
                replayClass: 'replay-optional',
                origin: 'daemon'
            }),
            ...(deriveActivityStateFromProgressState(progress.state) ? { activity: deriveActivityStateFromProgressState(progress.state) } : {}),
            progress: {
                ...(progress.summary ? { summary: progress.summary } : {}),
                ...(progress.detail ? { detail: progress.detail } : {}),
                ...(progress.units ? { units: cloneStructured(progress.units) } : {})
            }
        }));
    }

    private createHeaderRecord(
        input: AgentExecutionJournalLaunchInput,
        reference: AgentExecutionJournalReferenceType
    ): AgentExecutionJournalHeaderRecordType {
        return {
            ...this.createRecordBase<AgentExecutionJournalHeaderRecordType>(input, reference, 0, this.createRecordId(), [], undefined, {
                type: 'journal.header',
                family: 'journal.header',
                entrySemantics: 'event',
                authority: 'daemon',
                assertionLevel: 'authoritative',
                replayClass: 'replay-critical',
                origin: 'daemon'
            }),
            kind: 'agent-execution-interaction-journal',
            agentId: input.agentId,
            protocolDescriptor: input.protocolDescriptor,
            ...(input.transportState ? { transportState: { ...input.transportState } } : {}),
            ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {})
        };
    }

    private resolveJournalContext(input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>) {
        const reference = this.resolveReference({
            ...input,
            agentId: 'unknown-agent',
            protocolDescriptor: undefined as never
        });
        const store = this.resolveStore({
            ...input,
            agentId: 'unknown-agent',
            protocolDescriptor: undefined as never,
            reference
        });
        return { reference, store };
    }

    private async appendRecord<TRecord extends AgentExecutionJournalRecordType>(
        input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>,
        createRecord: (context: {
            reference: AgentExecutionJournalReferenceType;
            sequence: number;
            recordId: string;
            existingRecords: AgentExecutionJournalRecordType[];
            executionContextSeed: JournalExecutionContextSeed;
        }) => TRecord
    ): Promise<TRecord> {
        const { reference, store } = this.resolveJournalContext(input);
        const state = await this.readOrCreateJournalState(reference, store);
        const sequence = state.lastSequence + 1;
        const recordId = this.createRecordId();
        const record = createRecord({
            reference,
            sequence,
            recordId,
            existingRecords: [],
            executionContextSeed: state.executionContextSeed
        });
        await store.appendRecord(reference, record);
        this.journalStateById.set(reference.journalId, {
            ...state,
            lastSequence: sequence,
            recordCount: state.recordCount + 1
        });
        return record;
    }

    private async readOrCreateJournalState(
        reference: AgentExecutionJournalReferenceType,
        store: AgentExecutionJournalStore
    ): Promise<JournalAppendState> {
        const existing = this.journalStateById.get(reference.journalId);
        if (existing) {
            return existing;
        }

        const records = await store.readRecords(reference);
        const state = buildJournalAppendState(reference, records);
        this.journalStateById.set(reference.journalId, state);
        return state;
    }

    private createRecordBase<TRecord extends AgentExecutionJournalRecordType>(
        input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>,
        reference: AgentExecutionJournalReferenceType,
        sequence: number,
        recordId: string,
        existingRecords: AgentExecutionJournalRecordType[],
        executionContextSeed: JournalExecutionContextSeed | undefined,
        metadata: {
            type: TRecord['type'];
            family: TRecord['family'];
            entrySemantics: TRecord['entrySemantics'];
            authority: TRecord['authority'];
            assertionLevel: TRecord['assertionLevel'];
            replayClass: TRecord['replayClass'];
            origin: TRecord['origin'];
        }
    ): JournalRecordBase<TRecord> {
        return {
            recordId,
            sequence,
            type: metadata.type,
            family: metadata.family,
            entrySemantics: metadata.entrySemantics,
            authority: metadata.authority,
            assertionLevel: metadata.assertionLevel,
            replayClass: metadata.replayClass,
            origin: metadata.origin,
            schemaVersion: 1,
            agentExecutionId: input.agentExecutionId,
            executionContext: createExecutionContextDescriptor(
                createExecutionContextInput({
                    reference,
                    scope: input.scope,
                    type: metadata.type,
                    ...(executionContextSeed ? { executionContextSeed } : {}),
                    ...(metadata.type === 'journal.header'
                        ? { launchInput: input as AgentExecutionJournalLaunchInput }
                        : {}),
                    existingRecords
                })
            ),
            occurredAt: this.now()
        } as JournalRecordBase<TRecord>;
    }
}

const JOURNAL_PROTOCOL_VERSION = '2026-05-10';
const MISSION_CORE_RUNTIME_VERSION = readMissionCoreRuntimeVersion();

type JournalRecordBase<TRecord extends AgentExecutionJournalRecordType> = Pick<
    TRecord,
    | 'recordId'
    | 'sequence'
    | 'type'
    | 'family'
    | 'entrySemantics'
    | 'authority'
    | 'assertionLevel'
    | 'replayClass'
    | 'origin'
    | 'schemaVersion'
    | 'agentExecutionId'
    | 'executionContext'
    | 'occurredAt'
>;

type JournalExecutionContextSeed = {
    agentAdapter: string;
    runtimeVersion: string;
    protocolVersion: string;
};

type JournalAppendState = {
    reference: AgentExecutionJournalReferenceType;
    lastSequence: number;
    recordCount: number;
    executionContextSeed: JournalExecutionContextSeed;
};

export function createDefaultAgentExecutionJournalWriter(): AgentExecutionJournalWriter {
    return new AgentExecutionJournalWriter();
}

export function createAgentExecutionJournalReference(
    input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>
): AgentExecutionJournalReferenceType {
    const owner = resolveAgentExecutionJournalOwner(input.scope);
    return {
        journalId: `agent-execution-journal:${owner.ownerEntity}/${owner.ownerId}/${input.agentExecutionId}`,
        ownerEntity: owner.ownerEntity,
        ownerId: owner.ownerId,
        agentExecutionId: input.agentExecutionId,
        recordCount: 0,
        lastSequence: 0
    };
}

export function createFileBackedJournalStoreForLaunch(
    input: AgentExecutionJournalLaunchInput & {
        reference: AgentExecutionJournalReferenceType;
    }
): AgentExecutionJournalStore {
    const target = resolveFileBackedJournalPath(input);
    return new AgentExecutionJournalFileStore({
        resolvePath: () => target
    });
}

export function resolveFileBackedJournalPath(
    input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope' | 'workingDirectory'>
): AgentExecutionJournalFileStorePath {
    return {
        rootPath: resolveFileBackedJournalRoot(input.scope, input.workingDirectory),
        relativePath: buildAgentExecutionJournalRelativePath(input.agentExecutionId)
    };
}

export function buildAgentExecutionJournalRelativePath(agentExecutionId: string): string {
    return path.posix.join('agent-journals', `${encodeURIComponent(agentExecutionId)}.interaction.jsonl`);
}

function mapPromptSource(source: AgentPrompt['source']): AgentExecutionMessageAcceptedRecordType['source'] {
    switch (source) {
        case 'operator':
            return 'operator';
        case 'system':
            return 'system';
        case 'engine':
            return 'daemon';
    }
}

function mapObservationSource(observation: AgentExecutionObservation): AgentExecutionObservationRecordType['source'] {
    switch (observation.route.origin) {
        case 'daemon':
            return 'daemon';
        case 'provider-output':
            return 'provider-output';
        case 'agent-signal':
            return observation.rawText ? 'pty' : 'mcp';
        case 'terminal-output':
            return 'terminal-heuristic';
    }
}

function mapObservationOrigin(observation: AgentExecutionObservation): AgentExecutionJournalOriginType {
    return mapObservationSource(observation);
}

function mapObservationAuthority(observation: AgentExecutionObservation): AgentExecutionJournalRecordAuthorityType {
    return observation.route.origin === 'agent-signal' ? 'agent' : 'daemon';
}

function mapObservationAssertionLevel(observation: AgentExecutionObservation): AgentExecutionJournalRecordBaseType['assertionLevel'] {
    if (observation.route.origin === 'terminal-output' && observation.signal.type === 'message') {
        return 'informational';
    }
    return observation.signal.confidence === 'diagnostic'
        ? 'diagnostic'
        : observation.route.origin === 'agent-signal'
            ? 'advisory'
            : 'authoritative';
}

function mapObservationConfidence(
    confidence: AgentExecutionObservation['signal']['confidence']
): AgentExecutionObservationRecordType['confidence'] {
    return confidence === 'high' || confidence === 'medium' || confidence === 'low'
        ? confidence
        : 'diagnostic';
}

function mapDecisionAction(decision: AgentExecutionSignalDecision): AgentExecutionDecisionRecordType['action'] {
    switch (decision.action) {
        case 'reject':
            return 'reject';
        case 'record-observation-only':
            return 'record-only';
        case 'emit-message':
            return 'emit-message';
        case 'update-execution':
            return 'update-state';
    }
}

function readDecisionReason(decision: AgentExecutionSignalDecision): string | undefined {
    switch (decision.action) {
        case 'reject':
        case 'record-observation-only':
            return decision.reason;
        default:
            return undefined;
    }
}

function mapStateChangedLifecycle(
    decision: Extract<AgentExecutionSignalDecision, { action: 'update-execution' }>
): AgentExecutionStateChangedRecordType['lifecycle'] | undefined {
    const status = decision.snapshotPatch.status;
    if (!status) {
        return undefined;
    }
    return status;
}

function cloneStructured<TValue>(value: TValue): TValue {
    return structuredClone(value);
}

function resolveAgentExecutionJournalOwner(scope: AgentExecutionScope): {
    ownerEntity: AgentExecutionProtocolOwnerEntityType;
    ownerId: string;
} {
    switch (scope.kind) {
        case 'system':
            return {
                ownerEntity: 'System',
                ownerId: scope.label?.trim() || 'system'
            };
        case 'repository':
            return {
                ownerEntity: 'Repository',
                ownerId: scope.repositoryRootPath.trim()
            };
        case 'mission':
            return {
                ownerEntity: 'Mission',
                ownerId: scope.missionId.trim()
            };
        case 'task':
            return {
                ownerEntity: 'Task',
                ownerId: scope.taskId.trim()
            };
        case 'artifact':
            return {
                ownerEntity: 'Artifact',
                ownerId: scope.artifactId.trim()
            };
    }
}

function createExecutionContextDescriptor(input: {
    reference: AgentExecutionJournalReferenceType;
    scope: AgentExecutionScope;
    agentAdapter: string;
    runtimeVersion: string;
    protocolVersion: string;
}): AgentExecutionJournalExecutionContextType {
    const repositoryId = readRepositoryIdFromScope(input.scope);
    const missionId = readMissionIdFromScope(input.scope);
    const taskId = input.scope.kind === 'task'
        ? input.scope.taskId
        : input.scope.kind === 'artifact'
            ? input.scope.taskId
            : undefined;
    const stageId = input.scope.kind === 'task'
        ? input.scope.stageId
        : input.scope.kind === 'artifact'
            ? input.scope.stageId
            : undefined;

    return {
        owner: {
            entityType: input.reference.ownerEntity,
            entityId: input.reference.ownerId
        },
        ...(missionId
            ? {
                mission: {
                    missionId,
                    ...(stageId ? { stageId } : {}),
                    ...(taskId ? { taskId } : {})
                }
            }
            : {}),
        ...(repositoryId
            ? {
                repository: {
                    repositoryId
                }
            }
            : {}),
        runtime: {
            agentAdapter: input.agentAdapter,
            ...(stageId ? { workflowStage: stageId } : {})
        },
        daemon: {
            runtimeVersion: input.runtimeVersion,
            protocolVersion: input.protocolVersion
        }
    };
}

function createExecutionContextInput(input: {
    reference: AgentExecutionJournalReferenceType;
    scope: AgentExecutionScope;
    type: AgentExecutionJournalRecordType['type'];
    launchInput?: AgentExecutionJournalLaunchInput;
    executionContextSeed?: JournalExecutionContextSeed;
    existingRecords: AgentExecutionJournalRecordType[];
}): {
    reference: AgentExecutionJournalReferenceType;
    scope: AgentExecutionScope;
    agentAdapter: string;
    runtimeVersion: string;
    protocolVersion: string;
} {
    if (input.type === 'journal.header' && input.launchInput) {
        return {
            reference: input.reference,
            scope: input.scope,
            agentAdapter: input.launchInput.agentId,
            runtimeVersion: MISSION_CORE_RUNTIME_VERSION,
            protocolVersion: JOURNAL_PROTOCOL_VERSION
        };
    }

    if (input.executionContextSeed) {
        return {
            reference: input.reference,
            scope: input.scope,
            agentAdapter: input.executionContextSeed.agentAdapter,
            runtimeVersion: input.executionContextSeed.runtimeVersion,
            protocolVersion: input.executionContextSeed.protocolVersion
        };
    }

    const headerRecord = readHeaderRecord(input.existingRecords);
    return {
        reference: input.reference,
        scope: input.scope,
        agentAdapter: headerRecord?.agentId ?? 'unknown-agent',
        runtimeVersion: headerRecord?.executionContext.daemon.runtimeVersion ?? MISSION_CORE_RUNTIME_VERSION,
        protocolVersion: headerRecord?.executionContext.daemon.protocolVersion ?? JOURNAL_PROTOCOL_VERSION
    };
}

function readHeaderRecord(records: AgentExecutionJournalRecordType[]): AgentExecutionJournalHeaderRecordType | undefined {
    const headerRecord = records.find((record) => record.type === 'journal.header');
    return headerRecord?.type === 'journal.header' ? headerRecord : undefined;
}

function buildJournalAppendState(
    reference: AgentExecutionJournalReferenceType,
    records: AgentExecutionJournalRecordType[]
): JournalAppendState {
    const headerRecord = readHeaderRecord(records);
    return {
        reference,
        lastSequence: records.length > 0 ? records[records.length - 1]!.sequence : -1,
        recordCount: records.length,
        executionContextSeed: {
            agentAdapter: headerRecord?.agentId ?? 'unknown-agent',
            runtimeVersion: headerRecord?.executionContext.daemon.runtimeVersion ?? MISSION_CORE_RUNTIME_VERSION,
            protocolVersion: headerRecord?.executionContext.daemon.protocolVersion ?? JOURNAL_PROTOCOL_VERSION
        }
    };
}

function readMissionCoreRuntimeVersion(): string {
    try {
        const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
        return typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
            ? packageJson.version.trim()
            : 'unknown';
    } catch {
        return 'unknown';
    }
}

function readRepositoryIdFromScope(scope: AgentExecutionScope): string | undefined {
    switch (scope.kind) {
        case 'repository':
            return scope.repositoryRootPath;
        case 'mission':
        case 'task':
            return scope.repositoryRootPath;
        case 'artifact':
            return scope.repositoryRootPath;
        case 'system':
            return undefined;
    }
}

function readMissionIdFromScope(scope: AgentExecutionScope): string | undefined {
    switch (scope.kind) {
        case 'mission':
        case 'task':
            return scope.missionId;
        case 'artifact':
            return scope.missionId;
        case 'repository':
        case 'system':
            return undefined;
    }
}

function resolveFileBackedJournalRoot(scope: AgentExecutionScope, workingDirectory?: string): string {
    switch (scope.kind) {
        case 'system':
            return getMissionDaemonDirectory();
        case 'repository':
            return Repository.getMissionDirectoryPath(scope.repositoryRootPath);
        case 'mission': {
            const repositoryRootPath = requireRepositoryRootPath(scope.repositoryRootPath, scope.kind, workingDirectory);
            return path.join(Repository.getMissionCatalogPath(repositoryRootPath), scope.missionId);
        }
        case 'task': {
            const repositoryRootPath = requireRepositoryRootPath(scope.repositoryRootPath, scope.kind, workingDirectory);
            return path.join(Repository.getMissionCatalogPath(repositoryRootPath), scope.missionId);
        }
        case 'artifact': {
            if (scope.missionId) {
                const repositoryRootPath = requireRepositoryRootPath(scope.repositoryRootPath, scope.kind, workingDirectory);
                return path.join(Repository.getMissionCatalogPath(repositoryRootPath), scope.missionId);
            }
            if (scope.repositoryRootPath) {
                return Repository.getMissionDirectoryPath(scope.repositoryRootPath);
            }
            throw new Error('Artifact-scoped AgentExecution journal storage requires repositoryRootPath or missionId-backed repository scope.');
        }
    }
}

function requireRepositoryRootPath(
    repositoryRootPath: string | undefined,
    scopeKind: AgentLaunchConfig['scope']['kind'],
    workingDirectory?: string
): string {
    const normalizedRepositoryRootPath = repositoryRootPath?.trim();
    if (normalizedRepositoryRootPath) {
        return normalizedRepositoryRootPath;
    }
    throw new Error(`AgentExecution journal storage for scope '${scopeKind}' requires repositoryRootPath. Working directory '${workingDirectory?.trim() || 'unknown'}' is not a valid substitute.`);
}