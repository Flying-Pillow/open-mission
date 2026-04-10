import type {
    AgentCommand,
    AgentRunnerId,
    AgentTransportId,
    AgentSessionEvent,
    AgentSessionId,
    AgentSessionSnapshot,
    AgentPrompt
} from './AgentRuntimeTypes.js';

export interface AgentSession {
    readonly runnerId: AgentRunnerId;
    readonly transportId: AgentTransportId | undefined;
    readonly sessionId: AgentSessionId;

    getSnapshot(): AgentSessionSnapshot;
    onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void };

    submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
    cancel(reason?: string): Promise<AgentSessionSnapshot>;
    terminate(reason?: string): Promise<AgentSessionSnapshot>;
    dispose(): void;
}
