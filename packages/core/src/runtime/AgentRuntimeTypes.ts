export type AgentRuntimeId = string;
export type AgentTransportId = string;
export type AgentSessionId = string;

export type AgentSessionPhase =
    | 'starting'
    | 'running'
    | 'awaiting-input'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'terminated';

export type AgentPromptSource = 'engine' | 'operator' | 'system';

export type AgentCommandKind =
    | 'interrupt'
    | 'continue'
    | 'checkpoint'
    | 'finish';

export type AgentRuntimePrimitive = string | number | boolean | null;

export interface AgentRunnerCapabilities {
    attachableSessions: boolean;
    promptSubmission: boolean;
    structuredCommands: boolean;
    interruptible: boolean;
    interactiveInput: boolean;
    telemetry: boolean;
    mcpClient: boolean;
}

export interface McpServerReference {
    name: string;
    transport: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
}

export interface AgentSessionReference {
    runtimeId: AgentRuntimeId;
    transportId?: AgentTransportId;
    sessionId: AgentSessionId;
}

export interface AgentSessionStartRequest {
    missionId: string;
    taskId: string;
    workingDirectory: string;
    terminalSessionName?: string;
    transportId?: AgentTransportId;
    initialPrompt?: AgentPrompt;
    mcpServers?: McpServerReference[];
    metadata?: Record<string, AgentRuntimePrimitive>;
}

export interface AgentPrompt {
    source: AgentPromptSource;
    text: string;
    title?: string;
    metadata?: Record<string, AgentRuntimePrimitive>;
}

export interface AgentCommand {
    kind: AgentCommandKind;
    metadata?: Record<string, AgentRuntimePrimitive>;
}

export interface AgentSessionSnapshot {
    runtimeId: AgentRuntimeId;
    transportId?: AgentTransportId;
    sessionId: AgentSessionId;
    phase: AgentSessionPhase;
    workingDirectory?: string;
    taskId: string;
    missionId: string;
    acceptsPrompts: boolean;
    acceptedCommands: AgentCommandKind[];
    awaitingInput: boolean;
    failureMessage?: string;
    updatedAt: string;
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
        type: 'session.state-changed';
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
        type: 'prompt.accepted';
        prompt: AgentPrompt;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'prompt.rejected';
        prompt: AgentPrompt;
        reason: string;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'command.accepted';
        command: AgentCommand;
        snapshot: AgentSessionSnapshot;
    }
    | {
        type: 'command.rejected';
        command: AgentCommand;
        reason: string;
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
