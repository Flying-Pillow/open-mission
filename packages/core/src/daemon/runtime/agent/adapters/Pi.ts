import type { AgentProviderObservation } from '../signals/AgentProviderObservation.js';
import {
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';

const PI_AGENT_ID = 'pi' as const;

export const pi = {
    id: `agent:${PI_AGENT_ID}`,
    agentId: PI_AGENT_ID,
    displayName: 'Pi',
    adapter: {
        command: 'pi',
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
    if (parsed && getStringField(parsed, 'type') === 'tool_execution_start') {
        const toolName = getStringField(parsed, 'toolName');
        const args = getNestedRecord(parsed, 'args');
        if (toolName) {
            return [{
                kind: 'signal',
                signal: {
                    type: 'tool-call',
                    toolName,
                    args: typeof args?.['command'] === 'string'
                        ? args['command']
                        : JSON.stringify(args ?? {}),
                    source: 'provider-structured',
                    confidence: 'medium'
                }
            }];
        }
    }
    return [{ kind: 'none' }];
}
