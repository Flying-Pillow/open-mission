import { getContext, hasContext, setContext } from 'svelte';

type AgentExecutionSurfaceContext = {
    surfaceId?: string;
    surfacePath?: string;
    loading: boolean;
    error?: string | null;
};

const agentExecutionSurfaceContextKey = Symbol('agent-execution-surface-context');

export function setAgentExecutionSurfaceContext(value: AgentExecutionSurfaceContext): AgentExecutionSurfaceContext {
    setContext(agentExecutionSurfaceContextKey, value);
    return value;
}

export function getAgentExecutionSurfaceContext(): AgentExecutionSurfaceContext {
    return getContext(agentExecutionSurfaceContextKey);
}

export function maybeGetAgentExecutionSurfaceContext(): AgentExecutionSurfaceContext | undefined {
    return hasContext(agentExecutionSurfaceContextKey)
        ? getContext(agentExecutionSurfaceContextKey)
        : undefined;
}