import type { AgentRunner } from './AgentRunner.js';

export class AgentRunnerRegistry {
    private readonly runners = new Map<string, AgentRunner>();

    public register(runner: AgentRunner): void {
        const existing = this.runners.get(runner.id);
        if (existing && existing !== runner) {
            throw new Error(`Agent runner '${runner.id}' is already registered.`);
        }
        this.runners.set(runner.id, runner);
    }

    public get(runnerId: string): AgentRunner | undefined {
        return this.runners.get(runnerId);
    }

    public values(): Iterable<AgentRunner> {
        return this.runners.values();
    }

    public toMap(): ReadonlyMap<string, AgentRunner> {
        return this.runners;
    }
}
