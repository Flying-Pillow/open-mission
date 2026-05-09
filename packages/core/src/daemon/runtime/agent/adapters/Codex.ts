import {
    type AgentAdapterRuntimeOutput,
    type AgentAdapterTerminalOptions,
    type AgentExecutionMcpAccess,
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';
import type { AgentLaunchConfig } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { createAgentExecutionMcpBridge } from '../mcp/AgentExecutionMcpProvisioner.js';

const CODEX_AGENT_ID = 'codex' as const;
const CODEX_MCP_COMMAND_CONFIG_ENV = 'MISSION_CODEX_MCP_COMMAND_CONFIG';
const CODEX_MCP_ARGS_CONFIG_ENV = 'MISSION_CODEX_MCP_ARGS_CONFIG';
const CODEX_MCP_TOKEN_CONFIG_ENV = 'MISSION_CODEX_MCP_TOKEN_CONFIG';

export type CodexInput = {
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

export function createCodex(input: CodexInput = {}): AgentInput {
    const { command, env, ...terminalOptions } = input;
    return {
        id: `agent:${CODEX_AGENT_ID}`,
        agentId: CODEX_AGENT_ID,
        displayName: 'Codex',
        optionCatalog: {
            models: [
                { value: 'gpt-5.5', label: 'GPT-5.5' },
                { value: 'gpt-5.4', label: 'GPT-5.4' }
            ],
            reasoningEfforts: ['low', 'medium', 'high', 'xhigh']
        },
        default: true,
        supportsDefaultReasoningEffort: true,
        adapter: {
            command: command?.trim() || process.env['MISSION_CODEX_CLI_COMMAND']?.trim() || 'codex',
            providerSettings: {
                reasoningEfforts: ['low', 'medium', 'high', 'xhigh']
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
            prepareLaunchConfig: prepareCodexLaunchConfig,
            ...(env ? { runtimeEnv: env } : {}),
            terminalOptions,
            interactive: {
                args: [
                    { setting: 'model', flag: '--model' },
                    { launchEnv: CODEX_MCP_COMMAND_CONFIG_ENV, flag: '-c' },
                    { launchEnv: CODEX_MCP_ARGS_CONFIG_ENV, flag: '-c' },
                    { launchEnv: CODEX_MCP_TOKEN_CONFIG_ENV, flag: '-c' },
                    { prompt: 'initial' }
                ]
            },
            parseRuntimeOutputLine
        }
    } satisfies AgentInput;
}

export const codex = createCodex();

function parseRuntimeOutputLine(line: string): AgentAdapterRuntimeOutput[] {
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

function prepareCodexLaunchConfig(
    config: AgentLaunchConfig,
    _agent: AgentInput,
    mcpAccess?: AgentExecutionMcpAccess
) {
    if (!mcpAccess) {
        return { config };
    }

    const bridge = createAgentExecutionMcpBridge(mcpAccess);
    const bridgeToken = bridge.env['MISSION_MCP_TOKEN'];
    if (!bridgeToken) {
        throw new Error(`AgentExecution '${mcpAccess.agentExecutionId}' selected mcp-tool delivery but mission-mcp token provisioning failed.`);
    }
    return {
        config: {
            ...config,
            launchEnv: {
                ...(config.launchEnv ?? {}),
                [CODEX_MCP_COMMAND_CONFIG_ENV]: createCodexMcpConfigOverride('command', bridge.command),
                [CODEX_MCP_ARGS_CONFIG_ENV]: createCodexMcpConfigOverride('args', bridge.args),
                [CODEX_MCP_TOKEN_CONFIG_ENV]: createCodexMcpConfigOverride('env.MISSION_MCP_TOKEN', bridgeToken)
            }
        }
    };
}

function createCodexMcpConfigOverride(field: string, value: string | string[]): string {
    return `mcp_servers."mission-mcp".${field}=${JSON.stringify(value)}`;
}
