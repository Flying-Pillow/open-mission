import type { AgentProviderObservation } from '../signals/AgentProviderObservation.js';
import {
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';

const CODEX_AGENT_ID = 'codex' as const;

export const codex = {
    id: `agent:${CODEX_AGENT_ID}`,
    agentId: CODEX_AGENT_ID,
    displayName: 'Codex',
    supportsDefaultReasoningEffort: true,
    adapter: {
        command: 'codex',
        providerSettings: {
            reasoningEfforts: ['low', 'medium', 'high', 'xhigh']
        },
        interactive: {
            args: [
                { setting: 'model', flag: '--model' },
                { prompt: 'initial' }
            ]
        },
        parseRuntimeOutputLine
    }
} satisfies AgentInput;

function parseRuntimeOutputLine(line: string): AgentProviderObservation[] {
    const parsed = parseJsonLine(line);
    const item = parsed ? getNestedRecord(parsed, 'item') : undefined;
    if (parsed
        && getStringField(parsed, 'type') === 'item.completed'
        && item
        && getStringField(item, 'type') === 'agent_message') {
        const text = getStringField(item, 'text');
        if (text) {
            return [{ kind: 'message', channel: 'agent', text }];
        }
    }
    return [{ kind: 'none' }];
}
