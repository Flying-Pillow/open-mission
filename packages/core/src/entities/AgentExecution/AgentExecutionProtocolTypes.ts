import {
    MAX_AGENT_SIGNAL_MARKER_LENGTH as AGENT_SIGNAL_MARKER_LENGTH,
    MAX_AGENT_EXECUTION_MESSAGE_LENGTH as AGENT_EXECUTION_MESSAGE_LENGTH,
    MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES as AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES,
    MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH as AGENT_EXECUTION_SIGNAL_TEXT_LENGTH,
    MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES as AGENT_EXECUTION_SUGGESTED_RESPONSES,
    MAX_AGENT_EXECUTION_USAGE_ENTRIES as AGENT_EXECUTION_USAGE_ENTRIES,
    type AgentExecutionCommandType,
    type AgentExecutionInteractionCapabilitiesType,
    type AgentExecutionInteractionModeType,
    type AgentExecutionPromptType,
    type AgentExecutionScopeType,
    type AgentStatusSignalPayloadType
} from './AgentExecutionProtocolSchema.js';
import type { AgentExecutionTimelineItemType } from './AgentExecutionProjectionSchema.js';
import type {
    AgentExecutionAttentionStateType,
    AgentExecutionLifecycleStateType,
    AgentExecutionSnapshotType,
    AgentProgressSnapshotType,
    AgentProgressStateType
} from './AgentExecutionRuntimeSchema.js';
import type {
    AgentExecutionReferenceType,
    AgentExecutionTerminalTransportType
} from './AgentExecutionTransportSchema.js';
import {
    type AgentExecutionJournalSignalConfidenceType,
    type AgentExecutionJournalInputChoiceType,
    type AgentExecutionJournalSignalSourceType,
    type AgentExecutionJournalSignalType
} from './AgentExecutionSignalRegistry.js';

export type AgentId = string;
export type AgentExecutionId = string;
export type AgentMetadataValue = string | number | boolean | null;
export type AgentMetadata = Record<string, AgentMetadataValue>;

export type AgentExecutionScope = AgentExecutionScopeType;

export type AgentExecutionProtocolErrorCode =
    | 'adapter-not-available'
    | 'invalid-launch-config'
    | 'execution-not-found'
    | 'prompt-not-accepted'
    | 'command-not-supported'
    | 'invalid-execution-state'
    | 'launch-failed'
    | 'reconcile-failed';

export type AgentExecutionStatus = AgentExecutionLifecycleStateType;

export type AgentProgressState = AgentProgressStateType;

export type AgentExecutionStatusPhase = AgentStatusSignalPayloadType['phase'];

export type AgentAttentionState = AgentExecutionAttentionStateType;

export type AgentPromptSource = AgentExecutionPromptType['source'];

export type AgentExecutionInteractionMode = AgentExecutionInteractionModeType;

export type AgentExecutionInteractionCapabilities = AgentExecutionInteractionCapabilitiesType;

export type AgentProgressSnapshot = AgentProgressSnapshotType;

export type AgentExecutionReference = AgentExecutionReferenceType;

export type AgentExecutionTerminalTransport = AgentExecutionTerminalTransportType;

export interface AgentCapabilities {
    acceptsPromptSubmission: boolean;
    acceptsCommands: boolean;
    supportsInterrupt: boolean;
    supportsResumeByReference: boolean;
    supportsCheckpoint: boolean;
    exportFormats?: string[];
    shareModes?: string[];
}

export interface AgentTaskContext {
    taskId: string;
    stageId: string;
    title: string;
    description: string;
    instruction: string;
    acceptanceCriteria?: string[];
}

export interface AgentContextDocument {
    documentId: string;
    kind: 'spec' | 'brief' | 'artifact' | 'note';
    title: string;
    path?: string;
    summary?: string;
}

export interface AgentSpecificationContext {
    summary: string;
    documents: AgentContextDocument[];
}

export type AgentResumePolicy =
    | { mode: 'new' }
    | { mode: 'attach-or-create'; previousAgentExecutionId?: AgentExecutionId }
    | { mode: 'attach-only'; previousAgentExecutionId: AgentExecutionId };

export interface AgentLaunchConfig {
    scope: AgentExecutionScope;
    workingDirectory: string;
    task?: AgentTaskContext;
    specification?: AgentSpecificationContext;
    requestedAdapterId?: AgentId;
    resume: AgentResumePolicy;
    initialPrompt?: AgentPrompt;
    launchEnv?: Record<string, string>;
    metadata?: AgentMetadata;
}

export type AgentPrompt = AgentExecutionPromptType;

export type AgentCommand = AgentExecutionCommandType;

export type AgentExecutionSnapshot = AgentExecutionSnapshotType;

export interface AgentExecutionProtocolError extends Error {
    readonly code: AgentExecutionProtocolErrorCode;
    readonly agentId?: AgentId;
    readonly agentExecutionId?: AgentExecutionId;
}

export function getAgentExecutionScopeMissionId(scope: AgentExecutionScope): string | undefined {
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

export function getAgentExecutionScopeTaskId(scope: AgentExecutionScope): string | undefined {
    switch (scope.kind) {
        case 'task':
            return scope.taskId;
        case 'artifact':
            return scope.taskId;
        case 'mission':
        case 'repository':
        case 'system':
            return undefined;
    }
}

export function getAgentExecutionScopeStageId(scope: AgentExecutionScope): string | undefined {
    switch (scope.kind) {
        case 'task':
            return scope.stageId;
        case 'artifact':
            return scope.stageId;
        case 'mission':
        case 'repository':
        case 'system':
            return undefined;
    }
}

export function describeAgentExecutionScope(scope: AgentExecutionScope): string {
    switch (scope.kind) {
        case 'system':
            return scope.label?.trim() || 'system';
        case 'repository':
            return scope.repositoryRootPath;
        case 'mission':
            return scope.missionId;
        case 'task':
            return scope.taskId;
        case 'artifact':
            return scope.artifactId;
    }
}

export type AgentExecutionEvent =
    | {
        type: 'execution.started';
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.attached';
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.updated';
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.message';
        channel: 'stdout' | 'stderr' | 'system' | 'agent';
        text: string;
        timelineItem?: AgentExecutionTimelineItemType;
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.completed';
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.failed';
        reason: string;
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.cancelled';
        reason?: string;
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.terminated';
        reason?: string;
        snapshot: AgentExecutionSnapshot;
    };

export const MAX_AGENT_EXECUTION_SIGNAL_TEXT_LENGTH = AGENT_EXECUTION_SIGNAL_TEXT_LENGTH;
export const MAX_AGENT_EXECUTION_MESSAGE_LENGTH = AGENT_EXECUTION_MESSAGE_LENGTH;
export const MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES = AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES;
export const MAX_AGENT_EXECUTION_USAGE_ENTRIES = AGENT_EXECUTION_USAGE_ENTRIES;
export const MAX_AGENT_EXECUTION_SUGGESTED_RESPONSES = AGENT_EXECUTION_SUGGESTED_RESPONSES;
export const MAX_AGENT_SIGNAL_MARKER_LENGTH = AGENT_SIGNAL_MARKER_LENGTH;

export type AgentExecutionSignalSource = AgentExecutionJournalSignalSourceType;

export type AgentExecutionSignalConfidence = AgentExecutionJournalSignalConfidenceType;

export type AgentExecutionInputChoice = AgentExecutionJournalInputChoiceType;

export type AgentExecutionDiagnosticCode = Extract<AgentExecutionJournalSignalType, { type: 'diagnostic' }>['code'];

export type AgentExecutionSignal = AgentExecutionJournalSignalType;

export type AgentExecutionObservationAddress = {
    agentExecutionId: AgentExecutionId;
    scope: AgentExecutionScope;
};

export type AgentExecutionObservationOrigin =
    | 'daemon'
    | 'provider-output'
    | 'agent-signal'
    | 'terminal-output';

export type AgentExecutionSignalCandidate = {
    signal: AgentExecutionSignal;
    dedupeKey?: string;
    claimedAddress?: AgentExecutionObservationAddress;
    claimedAgentExecutionId?: AgentExecutionId;
    rawText?: string;
};

export type AgentExecutionObservation = {
    observationId: string;
    observedAt: string;
    signal: AgentExecutionSignal;
    route: {
        origin: AgentExecutionObservationOrigin;
        address: AgentExecutionObservationAddress;
    };
    claimedAddress?: AgentExecutionObservationAddress;
    rawText?: string;
};

export type AgentExecutionSignalDecision =
    | { action: 'reject'; reason: string }
    | { action: 'record-observation-only'; reason: string }
    | { action: 'emit-message'; event: AgentExecutionEvent }
    | {
        action: 'update-execution';
        eventType: 'execution.updated' | 'execution.completed' | 'execution.failed';
        snapshotPatch: Partial<AgentExecutionSnapshot>;
    };

export function cloneObservationAddress(address: AgentExecutionObservationAddress): AgentExecutionObservationAddress {
    return {
        agentExecutionId: address.agentExecutionId,
        scope: cloneAgentExecutionScope(address.scope)
    };
}

export function sameObservationAddress(
    left: AgentExecutionObservationAddress,
    right: AgentExecutionObservationAddress
): boolean {
    return left.agentExecutionId === right.agentExecutionId
        && sameAgentExecutionScope(left.scope, right.scope);
}

export function cloneAgentExecutionScope(scope: AgentExecutionScope): AgentExecutionScope {
    switch (scope.kind) {
        case 'system':
            return { kind: 'system', ...(scope.label ? { label: scope.label } : {}) };
        case 'repository':
            return { kind: 'repository', repositoryRootPath: scope.repositoryRootPath };
        case 'mission':
            return {
                kind: 'mission',
                missionId: scope.missionId,
                ...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {})
            };
        case 'task':
            return {
                kind: 'task',
                missionId: scope.missionId,
                taskId: scope.taskId,
                ...(scope.stageId ? { stageId: scope.stageId } : {}),
                ...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {})
            };
        case 'artifact':
            return {
                kind: 'artifact',
                artifactId: scope.artifactId,
                ...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {}),
                ...(scope.missionId ? { missionId: scope.missionId } : {}),
                ...(scope.taskId ? { taskId: scope.taskId } : {}),
                ...(scope.stageId ? { stageId: scope.stageId } : {})
            };
    }
}

export function sameAgentExecutionScope(left: AgentExecutionScope, right: AgentExecutionScope): boolean {
    return JSON.stringify(cloneAgentExecutionScope(left)) === JSON.stringify(cloneAgentExecutionScope(right));
}

export function cloneSignal(signal: AgentExecutionSignal): AgentExecutionSignal {
    return structuredClone(signal);
}

export function isScalarAgentMetadataValue(value: unknown): value is AgentMetadata[string] {
    return value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean';
}

export function deriveAgentExecutionInteractionCapabilities(input: Pick<
    AgentExecutionSnapshot,
    'status' | 'transport' | 'acceptsPrompts' | 'acceptedCommands'
>): AgentExecutionInteractionCapabilities {
    const terminalBacked = input.transport?.kind === 'terminal';
    const liveTerminal = terminalBacked && !isTerminalFinalStatus(input.status);
    if (liveTerminal) {
        return {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: input.acceptsPrompts,
            canSendStructuredCommand: input.acceptedCommands.length > 0
        };
    }

    const canSendStructuredPrompt = input.acceptsPrompts;
    const canSendStructuredCommand = input.acceptedCommands.length > 0;
    if (canSendStructuredPrompt || canSendStructuredCommand) {
        return {
            mode: 'agent-message',
            canSendTerminalInput: false,
            canSendStructuredPrompt,
            canSendStructuredCommand
        };
    }

    if (terminalBacked) {
        return {
            mode: 'read-only',
            canSendTerminalInput: false,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false,
            reason: 'The terminal is no longer accepting live input.'
        };
    }

    return {
        mode: 'read-only',
        canSendTerminalInput: false,
        canSendStructuredPrompt: false,
        canSendStructuredCommand: false,
        reason: 'This AgentExecution does not accept operator follow-up input.'
    };
}

export function isTerminalFinalStatus(status: AgentExecutionSnapshot['status']): boolean {
    return status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'terminated';
}
