export type AgentId = string;
export type AgentExecutionId = string;
export type AgentMetadataValue = string | number | boolean | null;
export type AgentMetadata = Record<string, AgentMetadataValue>;

export type AgentExecutionScope =
    | { kind: 'system'; label?: string }
    | { kind: 'repository'; repositoryRootPath: string }
    | { kind: 'mission'; missionId: string; repositoryRootPath?: string }
    | { kind: 'task'; missionId: string; taskId: string; stageId?: string; repositoryRootPath?: string }
    | {
        kind: 'artifact';
        artifactId: string;
        repositoryRootPath?: string;
        missionId?: string;
        taskId?: string;
        stageId?: string;
    };

export type AgentExecutionProtocolErrorCode =
    | 'adapter-not-available'
    | 'invalid-launch-config'
    | 'execution-not-found'
    | 'prompt-not-accepted'
    | 'command-not-supported'
    | 'invalid-execution-state'
    | 'launch-failed'
    | 'reconcile-failed';

export type AgentExecutionStatus =
    | 'starting'
    | 'running'
    | 'awaiting-input'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'terminated';

export type AgentProgressState =
    | 'unknown'
    | 'working'
    | 'waiting-input'
    | 'blocked'
    | 'done'
    | 'failed';

export type AgentAttentionState =
    | 'none'
    | 'autonomous'
    | 'awaiting-operator'
    | 'awaiting-system';

export type AgentPromptSource = 'engine' | 'operator' | 'system';

export type AgentExecutionInteractionMode =
    | 'pty-terminal'
    | 'agent-message'
    | 'read-only';

export interface AgentExecutionInteractionCapabilities {
    mode: AgentExecutionInteractionMode;
    canSendTerminalInput: boolean;
    canSendStructuredPrompt: boolean;
    canSendStructuredCommand: boolean;
    reason?: string;
}

export interface AgentProgressSnapshot {
    state: AgentProgressState;
    summary?: string;
    detail?: string;
    units?: {
        completed?: number;
        total?: number;
        unit?: string;
    };
    updatedAt: string;
}

export interface AgentExecutionReference {
    agentId: AgentId;
    sessionId: AgentExecutionId;
    processId?: number;
    transport?: {
        kind: 'terminal';
        terminalName: string;
        terminalPaneId?: string;
    };
}

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
    | { mode: 'attach-or-create'; previousSessionId?: AgentExecutionId }
    | { mode: 'attach-only'; previousSessionId: AgentExecutionId };

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

export interface AgentPrompt {
    source: AgentPromptSource;
    text: string;
    title?: string;
    metadata?: AgentMetadata;
}

export type AgentCommand =
    | { type: 'interrupt'; reason?: string; metadata?: AgentMetadata }
    | { type: 'checkpoint'; reason?: string; metadata?: AgentMetadata }
    | { type: 'nudge'; reason?: string; metadata?: AgentMetadata }
    | { type: 'resume'; reason?: string; metadata?: AgentMetadata };

export interface AgentExecutionSnapshot {
    agentId: AgentId;
    sessionId: AgentExecutionId;
    scope: AgentExecutionScope;
    workingDirectory: string;
    taskId?: string;
    missionId?: string;
    stageId?: string;
    status: AgentExecutionStatus;
    attention: AgentAttentionState;
    progress: AgentProgressSnapshot;
    waitingForInput: boolean;
    acceptsPrompts: boolean;
    acceptedCommands: AgentCommand['type'][];
    interactionCapabilities?: AgentExecutionInteractionCapabilities;
    transport?: {
        kind: 'terminal';
        terminalName: string;
        terminalPaneId?: string;
    };
    reference: AgentExecutionReference;
    failureMessage?: string;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
}

export interface AgentExecutionProtocolError extends Error {
    readonly code: AgentExecutionProtocolErrorCode;
    readonly agentId?: AgentId;
    readonly sessionId?: AgentExecutionId;
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
        snapshot: AgentExecutionSnapshot;
    }
    | {
        type: 'execution.awaiting-input';
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

export function deriveAgentExecutionInteractionCapabilities(input: Pick<
    AgentExecutionSnapshot,
    'status' | 'transport' | 'acceptsPrompts' | 'acceptedCommands'
>): AgentExecutionInteractionCapabilities {
    const terminalBacked = input.transport?.kind === 'terminal';
    const liveTerminal = terminalBacked && !isTerminalStatus(input.status);
    if (liveTerminal) {
        return {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false
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
        reason: 'This session does not accept operator follow-up input.'
    };
}

function isTerminalStatus(status: AgentExecutionSnapshot['status']): boolean {
    return status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'terminated';
}
