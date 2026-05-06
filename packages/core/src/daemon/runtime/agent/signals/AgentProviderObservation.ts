import type { AgentMetadata } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

export type AgentProviderSignal =
    | {
        type: 'provider-session';
        providerName: string;
        sessionId: string;
        source: 'provider-structured';
        confidence: 'high';
    }
    | {
        type: 'tool-call';
        toolName: string;
        args: string;
        source: 'provider-structured';
        confidence: 'medium';
    };

export type AgentProviderObservation =
    | { kind: 'message'; channel: 'agent' | 'system'; text: string }
    | { kind: 'signal'; signal: AgentProviderSignal }
    | { kind: 'usage'; payload: AgentMetadata }
    | { kind: 'none' };