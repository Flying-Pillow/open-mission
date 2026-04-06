import type { AgentSessionReference, AgentSessionSnapshot } from './AgentRuntimeTypes.js';

export interface PersistedAgentSessionStore {
    list(): Promise<AgentSessionReference[]>;
    load(reference: AgentSessionReference): Promise<AgentSessionSnapshot | undefined>;
    save(snapshot: AgentSessionSnapshot): Promise<void>;
    delete(reference: AgentSessionReference): Promise<void>;
}
