import type { AgentInput } from '../AgentAdapter.js';

export const agentAdapterInputs: AgentInput[] = [
    {
        id: 'agent:codex',
        agentId: 'codex',
        displayName: 'Codex',
        icon: 'lucide:bot',
        default: true,
        adapter: {
            command: process.execPath,
            defaultLaunchMode: 'interactive',
            transportId: 'terminal'
        }
    },
    {
        id: 'agent:pi',
        agentId: 'pi',
        displayName: 'Pi',
        icon: 'lucide:bot',
        adapter: {
            command: process.execPath,
            defaultLaunchMode: 'print',
            transportId: 'terminal'
        }
    },
    {
        id: 'agent:copilot-cli',
        agentId: 'copilot-cli',
        displayName: 'Copilot CLI',
        icon: 'lucide:bot',
        adapter: {
            command: process.execPath,
            defaultLaunchMode: 'interactive',
            transportId: 'terminal'
        }
    }
];