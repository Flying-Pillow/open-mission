import type { AgentInput } from '../AgentAdapter.js';

const OPENCODE_AGENT_ID = 'opencode' as const;

export const openCode = {
    id: `agent:${OPENCODE_AGENT_ID}`,
    agentId: OPENCODE_AGENT_ID,
    displayName: 'OpenCode',
    adapter: {
        command: 'opencode',
        interactive: {
            args: [
                { setting: 'model', flag: '--model' },
                { prompt: 'initial', flag: '-p' }
            ]
        }
    }
} satisfies AgentInput;
