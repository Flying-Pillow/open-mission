export type AgentRunnerId = string;
export type AgentSessionId = string;
export type AgentMetadataValue = string | number | boolean | null;
export type AgentMetadata = Record<string, AgentMetadataValue>;

export type AgentRuntimeErrorCode =
    | 'runner-not-available'
    | 'invalid-launch-config'
    | 'session-not-found'
    | 'prompt-not-accepted'
    | 'command-not-supported'
    | 'invalid-session-state'
    | 'launch-failed'
    | 'reconcile-failed';

export type AgentSessionStatus =
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

export type AgentSessionInteractionMode =
    | 'pty-terminal'
    | 'agent-message'
    | 'read-only';

export interface AgentSessionInteractionCapabilities {
    mode: AgentSessionInteractionMode;
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

export interface AgentSessionReference {
    runnerId: AgentRunnerId;
    sessionId: AgentSessionId;
    processId?: number;
    transport?: {
        kind: 'terminal';
        terminalSessionName: string;
        paneId?: string;
    };
}

export interface AgentRunnerCapabilities {
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
    | { mode: 'attach-or-create'; previousSessionId?: AgentSessionId }
    | { mode: 'attach-only'; previousSessionId: AgentSessionId };

export interface AgentLaunchConfig {
    missionId: string;
    workingDirectory: string;
    task: AgentTaskContext;
    specification: AgentSpecificationContext;
    requestedRunnerId?: AgentRunnerId;
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

export interface AgentSessionSnapshot {
    runnerId: AgentRunnerId;
    sessionId: AgentSessionId;
    workingDirectory: string;
    taskId: string;
    missionId: string;
    stageId: string;
    status: AgentSessionStatus;
    attention: AgentAttentionState;
    progress: AgentProgressSnapshot;
    waitingForInput: boolean;
    acceptsPrompts: boolean;
    acceptedCommands: AgentCommand['type'][];
    interactionCapabilities?: AgentSessionInteractionCapabilities;
    transport?: {
        kind: 'terminal';
        terminalSessionName: string;
        paneId?: string;
    };
    reference: AgentSessionReference;
    failureMessage?: string;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
}

export interface AgentRuntimeError extends Error {
    readonly code: AgentRuntimeErrorCode;
    readonly runnerId?: AgentRunnerId;
    readonly sessionId?: AgentSessionId;
}

export type AgentSessionEvent =
    | {
        type: 'session.started';
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.attached';
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.updated';
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.message';
        channel: 'stdout' | 'stderr' | 'system' | 'agent';
        text: string;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.awaiting-input';
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.completed';
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.failed';
        reason: string;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.cancelled';
        reason?: string;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'session.terminated';
        reason?: string;
        snapshot: AgentSessionSnapshot;
    };

export function deriveAgentSessionInteractionCapabilities(input: Pick<
    AgentSessionSnapshot,
    'status' | 'transport' | 'acceptsPrompts' | 'acceptedCommands'
>): AgentSessionInteractionCapabilities {
    const terminalBacked = input.transport?.kind === 'terminal';
    const liveTerminalSession = terminalBacked && !isTerminalSessionStatus(input.status);
    if (liveTerminalSession) {
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
            reason: 'The terminal session is no longer accepting live input.'
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

function isTerminalSessionStatus(status: AgentSessionSnapshot['status']): boolean {
    return status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'terminated';
}
