import type { AgentLaunchConfig } from '../../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import {
    type AgentAdapterProcessOutput,
    type AgentAdapterTerminalOptions,
    type AgentExecutionMcpAccess,
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';
import { provisionAgentExecutionMcpConfig } from '../mcp/AgentExecutionMcpProvisioner.js';

const CLAUDE_CODE_AGENT_ID = 'claude-code' as const;

const CLAUDE_MCP_CONFIG_ENV = 'OPEN_MISSION_AGENT_MCP_CONFIG';

export type ClaudeCodeInput = {
    command?: string;
    env?: NodeJS.ProcessEnv;
} & Partial<Pick<AgentAdapterTerminalOptions,
    | 'terminalPrefix'
    | 'spawn'
    | 'processController'
    | 'terminationGraceMs'
    | 'terminationPollIntervalMs'
    | 'screenFactory'
>>;

export function createClaudeCode(input: ClaudeCodeInput = {}): AgentInput {
    const { command, env, ...terminalOptions } = input;
    return {
        id: `agent:${CLAUDE_CODE_AGENT_ID}`,
        agentId: CLAUDE_CODE_AGENT_ID,
        displayName: 'Claude Code',
        icon: 'simple-icons:anthropic',
        adapter: {
            command: command?.trim() || process.env['OPEN_MISSION_CLAUDE_CODE_CLI_COMMAND']?.trim() || 'claude',
            providerSettings: {
                allowDangerouslySkipPermissions: true,
                allowCaptureAgentExecutions: true
            },
            transportCapabilities: {
                supported: ['stdout-marker', 'mcp-tool'],
                preferred: {
                    interactive: 'mcp-tool',
                    print: 'stdout-marker'
                },
                provisioning: {
                    requiresRuntimeConfig: true,
                    supportsStdioBridge: true,
                    supportsAgentExecutionScopedTools: true
                }
            },
            prepareLaunchConfig: prepareClaudeCodeLaunchConfig,
            ...(env ? { runtimeEnv: env } : {}),
            terminalOptions,
            interactive: {
                args: [
                    '--verbose',
                    { setting: 'model', flag: '--model' },
                    { setting: 'reasoningEffort', flag: '--effort' },
                    { when: 'dangerouslySkipPermissions', value: '--dangerously-skip-permissions' },
                    { launchEnv: CLAUDE_MCP_CONFIG_ENV, flag: '--mcp-config' },
                    { trustedDirectories: true, flag: '--add-dir' },
                    { prompt: 'initial', omitWhenEmpty: true }
                ]
            },
            print: {
                args: [
                    '--print',
                    '--output-format',
                    'stream-json',
                    { setting: 'model', flag: '--model' },
                    { setting: 'reasoningEffort', flag: '--effort' },
                    { when: 'dangerouslySkipPermissions', value: '--dangerously-skip-permissions' },
                    { launchEnv: CLAUDE_MCP_CONFIG_ENV, flag: '--mcp-config' },
                    { trustedDirectories: true, flag: '--add-dir' },
                    { prompt: 'initial', omitWhenEmpty: true }
                ]
            },
            parseProcessOutputLine,
            parseAgentExecutionUsageContent,
            diagnoseConnectionFailure
        }
    } satisfies AgentInput;
}

export const claudeCode = createClaudeCode();

async function prepareClaudeCodeLaunchConfig(
    config: AgentLaunchConfig,
    _agent: AgentInput,
    mcpAccess?: AgentExecutionMcpAccess
) {
    if (!mcpAccess) {
        return { config };
    }

    return provisionAgentExecutionMcpConfig({
        config,
        access: mcpAccess,
        launchEnvName: CLAUDE_MCP_CONFIG_ENV,
        configFileName: 'open-mission-mcp.json',
        createDocument: (bridge) => ({
            mcpServers: {
                [mcpAccess.serverName]: bridge
            }
        })
    });
}

function parseProcessOutputLine(line: string, agent: AgentInput): AgentAdapterProcessOutput[] {
    const parsed = parseJsonLine(line);
    if (!parsed) {
        return [{ kind: 'none' }];
    }

    if (getStringField(parsed, 'type') === 'system'
        && getStringField(parsed, 'subtype') === 'init') {
        const agentExecutionId = getStringField(parsed, 'session_id');
        if (agentExecutionId) {
            return [{
                kind: 'signal',
                signal: {
                    type: 'provider-execution',
                    providerName: agent.agentId,
                    agentExecutionId,
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

function parseAgentExecutionUsageContent(content: string): AgentAdapterProcessOutput | undefined {
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

function diagnoseConnectionFailure(input: {
    stdout: string;
    stderr: string;
}): import('../AgentAdapter.js').AgentConnectionFailureDiagnostic | undefined {
    const text = `${input.stdout}\n${input.stderr}`;
    if (/\b401\b/.test(text) || /\/login/.test(text) || /(auth|oauth|credential|token).*(fail|invalid|missing|expired|unauthorized)/i.test(text)) {
        return {
            kind: 'auth-failed',
            summary: 'Claude Code authentication is missing or invalid.',
            detail: 'Run `claude` and use `/login`, or verify the configured Claude profile and proxy credentials before retrying.',
            diagnosticCode: 'claude-auth'
        };
    }
    if (/anthropic_base_url|proxy/i.test(text)) {
        return {
            kind: 'auth-failed',
            summary: 'Claude Code custom endpoint or proxy authentication failed.',
            detail: 'Check the configured Claude proxy base URL and credentials, then retry the connection test.',
            diagnosticCode: 'claude-proxy-auth'
        };
    }
    return undefined;
}
