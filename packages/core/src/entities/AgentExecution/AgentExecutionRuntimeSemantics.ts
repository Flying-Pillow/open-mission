import type {
    AgentExecutionAttentionStateType,
    AgentExecutionActivityStateType,
    AgentExecutionLifecycleStateType,
} from './AgentExecutionRuntimeSchema.js';
import type {
    AgentExecutionStatusPhase,
    AgentProgressState
} from './AgentExecutionProtocolTypes.js';

const PROGRESS_STATE_ACTIVITY: Record<AgentProgressState, AgentExecutionActivityStateType | undefined> = {
    initializing: 'idle',
    unknown: undefined,
    working: 'executing',
    idle: 'idle',
    'waiting-input': 'communicating',
    blocked: 'executing',
    done: undefined,
    failed: undefined
};

export function deriveActivityStateFromProgressState(
    progressState: AgentProgressState | undefined
): AgentExecutionActivityStateType | undefined {
    if (!progressState) {
        return undefined;
    }
    return PROGRESS_STATE_ACTIVITY[progressState];
}

export function deriveLifecycleStateFromStatusSignalPhase(
    phase: AgentExecutionStatusPhase
): AgentExecutionLifecycleStateType {
    return phase === 'initializing' ? 'starting' : 'running';
}

export function deriveAttentionFromStatusSignalPhase(input: {
    phase: AgentExecutionStatusPhase;
    preservesInputRequest: boolean;
}): AgentExecutionAttentionStateType {
    if (input.phase === 'idle' || input.preservesInputRequest) {
        return 'awaiting-operator';
    }
    return 'none';
}