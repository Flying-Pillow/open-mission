import { randomUUID } from 'node:crypto';
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
    AgentExecutionJournalReferenceType,
    AgentExecutionJournalRecordType,
    AgentExecutionJournalStore,
    AgentExecutionMessageAcceptedRecordType,
    AgentExecutionMessageDeliveryRecordType,
    AgentExecutionObservationRecordType,
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

    public constructor(options: AgentExecutionJournalWriterOptions = {}) {
        this.resolveReference = options.resolveReference ?? createAgentExecutionJournalReference;
        this.resolveStore = options.resolveStore ?? createFileBackedJournalStoreForLaunch;
        this.createRecordId = options.createRecordId ?? randomUUID;
        this.now = options.now ?? (() => new Date().toISOString());
    }

    public async ensureLaunchJournal(input: AgentExecutionJournalLaunchInput): Promise<AgentExecutionJournalReferenceType> {
        const { reference, store } = this.resolveJournalContext(input);
        await store.ensureJournal(reference);
        await store.appendRecord(reference, this.createHeaderRecord(input, reference));
        return {
            ...reference,
            recordCount: 1,
            lastSequence: 0
        };
    }

    public async readRecords(input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>): Promise<AgentExecutionJournalRecordType[]> {
        const { reference, store } = this.resolveJournalContext(input);
        return store.readRecords(reference);
    }

    public async appendPromptAccepted(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        prompt: AgentPrompt;
    }): Promise<AgentExecutionMessageAcceptedRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase(input, context.reference, context.sequence, 'message.accepted', context.recordId),
            messageId: context.recordId,
            source: mapPromptSource(input.prompt.source),
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
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase(input, context.reference, context.sequence, 'message.accepted', context.recordId),
            messageId: context.recordId,
            source: input.source ?? 'operator',
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
            ...this.createRecordBase(input, context.reference, context.sequence, 'message.delivery', context.recordId),
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
            ...this.createRecordBase(input, context.reference, context.sequence, 'observation.recorded', context.recordId),
            observationId: input.observation.observationId,
            source: mapObservationSource(input.observation),
            confidence: mapObservationConfidence(input.observation.signal.confidence),
            signal: cloneStructured(input.observation.signal),
            ...(input.observation.rawText ? { rawText: input.observation.rawText } : {})
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
            ...this.createRecordBase(input, context.reference, context.sequence, 'decision.recorded', context.recordId),
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
    }): Promise<AgentExecutionStateChangedRecordType> {
        return this.appendRecord(input, (context) => ({
            ...this.createRecordBase(input, context.reference, context.sequence, 'state.changed', context.recordId),
            ...(mapStateChangedLifecycle(input.decision) ? { lifecycle: mapStateChangedLifecycle(input.decision) } : {}),
            ...(input.decision.snapshotPatch.attention ? { attention: input.decision.snapshotPatch.attention } : {}),
            ...(input.decision.snapshotPatch.progress?.state && mapSemanticActivity(input.decision.snapshotPatch.progress.state)
                ? { activity: mapSemanticActivity(input.decision.snapshotPatch.progress.state) }
                : {}),
            ...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {})
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
            ...this.createRecordBase(input, context.reference, context.sequence, 'activity.updated', context.recordId),
            ...(mapSemanticActivity(progress.state) ? { activity: mapSemanticActivity(progress.state) } : {}),
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
            recordId: this.createRecordId(),
            sequence: 0,
            type: 'journal.header',
            schemaVersion: 1,
            agentExecutionId: input.agentExecutionId,
            ownerId: reference.ownerId,
            scope: { ...input.scope },
            occurredAt: this.now(),
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
        createRecord: (context: { reference: AgentExecutionJournalReferenceType; sequence: number; recordId: string }) => TRecord
    ): Promise<TRecord> {
        const { reference, store } = this.resolveJournalContext(input);
        const existingRecords = await store.readRecords(reference);
        const sequence = existingRecords.length;
        const recordId = this.createRecordId();
        const record = createRecord({ reference, sequence, recordId });
        await store.appendRecord(reference, record);
        return record;
    }

    private createRecordBase<TType extends TJournalRecordType>(
        input: Pick<AgentExecutionJournalLaunchInput, 'agentExecutionId' | 'scope'>,
        reference: AgentExecutionJournalReferenceType,
        sequence: number,
        type: TType,
        recordId: string
    ): JournalRecordBase<TType> {
        return {
            recordId,
            sequence,
            type,
            schemaVersion: 1,
            agentExecutionId: input.agentExecutionId,
            ownerId: reference.ownerId,
            scope: cloneStructured(input.scope),
            occurredAt: this.now()
        } as JournalRecordBase<TType>;
    }
}

type TJournalRecordType = AgentExecutionJournalRecordType['type'];

type JournalRecordBase<TType extends TJournalRecordType> = {
    recordId: string;
    sequence: number;
    type: TType;
    schemaVersion: 1;
    agentExecutionId: string;
    ownerId: string;
    scope: AgentExecutionScope;
    occurredAt: string;
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
        case 'agent-declared-signal':
            return observation.rawText ? 'pty' : 'mcp';
        case 'terminal-output':
            return 'terminal-heuristic';
    }
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

function mapSemanticActivity(progressState: string | undefined): AgentExecutionActivityUpdatedRecordType['activity'] | undefined {
    switch (progressState) {
        case 'idle':
            return 'idle';
        case 'initializing':
            return 'planning';
        case 'waiting-input':
            return 'communicating';
        case 'working':
            return 'executing';
        case 'blocked':
            return 'executing';
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