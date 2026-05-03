import type {
	AgentCommand,
	AgentPrompt,
	AgentSessionEvent,
	AgentSessionReference,
	AgentSessionSnapshot
} from './AgentRuntimeTypes.js';

export interface AgentSession {
	readonly reference: AgentSessionReference;

	getSnapshot(): AgentSessionSnapshot;
	onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void };
	done(): Promise<AgentSessionSnapshot>;
	submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
	submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
	cancel(reason?: string): Promise<AgentSessionSnapshot>;
	terminate(reason?: string): Promise<AgentSessionSnapshot>;
}