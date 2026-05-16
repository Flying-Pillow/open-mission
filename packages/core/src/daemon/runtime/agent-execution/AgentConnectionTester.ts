import type { Agent } from '../../../entities/Agent/Agent.js';

export class AgentConnectionTester {
    public async test(input: {
        agent: Agent;
        repositoryRootPath: string;
        workingDirectory: string;
        model?: string;
        reasoningEffort?: string;
        launchMode?: 'interactive' | 'print';
        initialPrompt?: string;
    }): Promise<{
        ok: boolean;
        kind: 'success' | 'unknown';
        agentId: string;
        agentName: string;
        summary: string;
        detail?: string;
    }> {
        void input.repositoryRootPath;
        void input.workingDirectory;
        void input.model;
        void input.reasoningEffort;
        void input.launchMode;
        void input.initialPrompt;
        const available = await input.agent.requireAdapter().isAvailable();
        return available.available
            ? {
                ok: true,
                kind: 'success',
                agentId: input.agent.agentId,
                agentName: input.agent.displayName,
                summary: `${input.agent.displayName} is available.`
            }
            : {
                ok: false,
                kind: 'unknown',
                agentId: input.agent.agentId,
                agentName: input.agent.displayName,
                summary: `${input.agent.displayName} is unavailable.`,
                ...(available.reason ? { detail: available.reason } : {})
            };
    }
}