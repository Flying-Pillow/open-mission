import {
    type AgentAdapterRuntimeOutput,
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';

const CLAUDE_CODE_AGENT_ID = 'claude-code' as const;

export const claudeCode = {
    id: `agent:${CLAUDE_CODE_AGENT_ID}`,
    agentId: CLAUDE_CODE_AGENT_ID,
    displayName: 'Claude Code',
    supportsDefaultReasoningEffort: true,
    adapter: {
        command: 'claude',
        providerSettings: {
            reasoningEfforts: ['low', 'medium', 'high', 'max'],
            allowDangerouslySkipPermissions: true,
            allowCaptureSessions: true
        },
        interactive: {
            args: [
                '--verbose',
                '--output-format',
                'stream-json',
                { setting: 'model', flag: '--model' },
                { setting: 'reasoningEffort', flag: '--effort' },
                { when: 'dangerouslySkipPermissions', value: '--dangerously-skip-permissions' },
                { prompt: 'initial' }
            ]
        },
        parseRuntimeOutputLine,
        parseSessionUsageContent
    }
} satisfies AgentInput;

function parseRuntimeOutputLine(line: string, agent: AgentInput): AgentAdapterRuntimeOutput[] {
    const parsed = parseJsonLine(line);
    if (!parsed) {
        return [{ kind: 'none' }];
    }

    if (getStringField(parsed, 'type') === 'system'
        && getStringField(parsed, 'subtype') === 'init') {
        const sessionId = getStringField(parsed, 'session_id');
        if (sessionId) {
            return [{
                kind: 'signal',
                signal: {
                    type: 'provider-session',
                    providerName: agent.agentId,
                    sessionId,
                    source: 'provider-structured',
                    confidence: 'high'
                }
            }];
        }
    }

    const result = getStringField(parsed, 'result');
    if (result) {
        return [{ kind: 'message', channel: 'agent', text: result }];
    }

    const message = getNestedRecord(parsed, 'message');
    const messageText = message ? getStringField(message, 'text') ?? getStringField(message, 'content') : undefined;
    return messageText
        ? [{ kind: 'message', channel: 'agent', text: messageText }]
        : [{ kind: 'none' }];
}

function parseSessionUsageContent(content: string): AgentAdapterRuntimeOutput | undefined {
    let usageRecord: Record<string, unknown> | undefined;
    for (const line of content.split('\n')) {
        const parsed = parseJsonLine(line);
        const message = parsed ? getNestedRecord(parsed, 'message') : undefined;
        const usage = message ? getNestedRecord(message, 'usage') : undefined;
        if (usage) {
            usageRecord = usage;
        }
    }
    if (!usageRecord) {
        return undefined;
    }

    return {
        kind: 'usage',
        payload: {
            ...(typeof usageRecord['input_tokens'] === 'number' ? { inputTokens: usageRecord['input_tokens'] } : {}),
            ...(typeof usageRecord['cache_creation_input_tokens'] === 'number'
                ? { cacheCreationInputTokens: usageRecord['cache_creation_input_tokens'] }
                : {}),
            ...(typeof usageRecord['cache_read_input_tokens'] === 'number'
                ? { cacheReadInputTokens: usageRecord['cache_read_input_tokens'] }
                : {}),
            ...(typeof usageRecord['output_tokens'] === 'number' ? { outputTokens: usageRecord['output_tokens'] } : {})
        }
    };
}
