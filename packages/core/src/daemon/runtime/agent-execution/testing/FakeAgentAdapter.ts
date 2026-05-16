import { AgentAdapter } from '../adapter/AgentAdapter.js';

export class FakeAgentAdapter extends AgentAdapter {
    public constructor(id: string, displayName: string, transportId: 'terminal' | 'none' = 'none') {
        super({
            id,
            displayName,
            icon: 'lucide:bot',
            command: process.execPath,
            defaultLaunchMode: 'interactive',
            transportId
        });
    }

    public overrideAgentExecutionWorkingDirectory(agentExecutionId: string, workingDirectory: string): void {
        this.requireExecution(agentExecutionId).attachRuntimeContext({ workingDirectory });
    }
}