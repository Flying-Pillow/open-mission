import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
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
const CODEX_MCP_CONFIG_ENV = 'MISSION_CODEX_MCP_CONFIG';
const execFile = promisify(execFileCallback);

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
                    '--no-alt-screen',
                    { setting: 'model', flag: '--model' },
                    { launchEnv: CODEX_MCP_CONFIG_ENV, flag: '-c' },
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

async function prepareCodexLaunchConfig(
    config: AgentLaunchConfig,
    agent: AgentInput,
    mcpAccess?: AgentExecutionMcpAccess
) {
    await assertCodexAuthenticated(agent, config);

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
                [CODEX_MCP_CONFIG_ENV]: createCodexMcpConfigOverride(bridge.command, bridge.args, bridge.env)
            }
        }
    };
}

function createCodexMcpConfigOverride(command: string, args: string[], env: Record<string, string>): string {
    return [
        'mcp_servers={',
        '"mission-mcp"={',
        `command=${JSON.stringify(command)},`,
        `args=${JSON.stringify(args)},`,
        `env=${createTomlInlineTable(env)},`,
        'default_tools_approval_mode="approve"',
        '}',
        '}'
    ].join('');
}

function createTomlInlineTable(values: Record<string, string>): string {
    const entries = Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(',');
    return `{${entries}}`;
}

async function assertCodexAuthenticated(agent: AgentInput, config: AgentLaunchConfig): Promise<void> {
    const command = agent.adapter.command.trim();
    const env = {
        ...(agent.adapter.runtimeEnv ?? process.env),
        ...(config.launchEnv ?? {})
    };

    try {
        await execFile(command, ['login', 'status'], {
            env,
            timeout: 10000,
            windowsHide: true
        });
    } catch (error) {
        const statusOutput = [
            error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '',
            error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : ''
        ].join('\n').trim();

        if (statusOutput.includes('Not logged in')) {
            throw new Error('Codex is not logged in. Run `codex login` in the Mission runtime environment, then retry the AgentExecution.');
        }

        throw new Error(statusOutput
            ? `Codex authentication check failed: ${statusOutput}`
            : 'Codex authentication check failed before launch.');
    }
}
