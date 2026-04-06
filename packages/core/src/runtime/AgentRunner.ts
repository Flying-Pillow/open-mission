import type { AgentSession } from './AgentSession.js';
import type {
    AgentRunnerCapabilities,
    AgentRunnerId,
    AgentSessionReference,
    AgentSessionSnapshot,
    AgentSessionStartRequest
} from './AgentRuntimeTypes.js';

export interface AgentRunner {
    readonly id: AgentRunnerId;
    readonly displayName: string;
    readonly capabilities: AgentRunnerCapabilities;

    isAvailable(): Promise<{ available: boolean; detail?: string }>;
    startSession(request: AgentSessionStartRequest): Promise<AgentSession>;
    attachSession?(reference: AgentSessionReference): Promise<AgentSession>;
    listSessions?(): Promise<AgentSessionSnapshot[]>;
}
