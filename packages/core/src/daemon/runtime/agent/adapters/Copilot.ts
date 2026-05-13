import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentLaunchConfig } from '../../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import {
    type AgentInput,
    type AgentExecutionMcpAccess,
    type AgentAdapterTerminalOptions
} from '../AgentAdapter.js';
import { provisionAgentExecutionMcpConfig } from '../mcp/AgentExecutionMcpProvisioner.js';

const COPILOT_AGENT_ID = 'copilot-cli' as const;

export type CopilotInput = {
    command?: string;
    launchMode?: 'interactive' | 'print';
    trustedConfigDir?: string;
    env?: NodeJS.ProcessEnv;
} & Partial<Pick<AgentAdapterTerminalOptions,
    | 'terminalPrefix'
    | 'spawn'
    | 'processController'
    | 'terminationGraceMs'
    | 'terminationPollIntervalMs'
    | 'screenFactory'
>>;

export function createCopilot(input: CopilotInput = {}): AgentInput {
    const { command, launchMode, trustedConfigDir, env, ...terminalOptions } = input;
    const resolvedTrustedConfigDir = trustedConfigDir ? path.resolve(trustedConfigDir) : resolveTrustedConfigDir();
    const resolvedLaunchMode = launchMode ?? resolveLaunchMode();
    return {
        id: `agent:${COPILOT_AGENT_ID}`,
        agentId: COPILOT_AGENT_ID,
        displayName: 'Copilot CLI',
        icon: 'simple-icons:githubcopilot',
        adapter: {
            command: command?.trim() || process.env['OPEN_MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
            providerSettings: false,
            defaultLaunchMode: resolvedLaunchMode,
            trustedFolders: { configDir: resolvedTrustedConfigDir },
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
            prepareLaunchConfig: prepareCopilotLaunchConfig,
            ...(env ? { runtimeEnv: env } : {}),
            terminalOptions,
            interactive: {
                args: [
                    '--allow-all-paths',
                    '--allow-all-tools',
                    '--allow-all-urls',
                    { launchEnv: 'OPEN_MISSION_AGENT_MCP_CONFIG', flag: '--additional-mcp-config' },
                    { trustedConfigDir: true, flag: '--config-dir' },
                    { trustedDirectories: true, flag: '--add-dir' },
                    { prompt: 'initial', flag: '-i', trim: true, omitWhenEmpty: true }
                ]
            },
            print: {
                args: [
                    '--allow-all',
                    '--no-color',
                    '--silent',
                    '--output-format',
                    'text',
                    '--stream',
                    'on',
                    { trustedConfigDir: true, flag: '--config-dir' },
                    { trustedDirectories: true, flag: '--add-dir' },
                    { prompt: 'initial', flag: '-p', trim: true, omitWhenEmpty: true }
                ]
            },
            diagnoseConnectionFailure
        }
    };
}

export const copilot = createCopilot();

function resolveTrustedConfigDir(): string {
    const fromEnv = process.env['OPEN_MISSION_COPILOT_CONFIG_DIR']?.trim();
    return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), '.mission', 'copilot-cli');
}

function resolveLaunchMode(): 'interactive' | 'print' {
    const fromEnv = process.env['OPEN_MISSION_COPILOT_LAUNCH_MODE']?.trim();
    return fromEnv === 'print' ? 'print' : 'interactive';
}

async function prepareCopilotLaunchConfig(
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
        launchEnvName: 'OPEN_MISSION_AGENT_MCP_CONFIG',
        configFileName: 'open-mission-mcp.json',
        referenceConfigPath: (configPath) => `@${configPath}`,
        createDocument: (bridge) => ({
            mcpServers: {
                [mcpAccess.serverName]: bridge
            }
        })
    });
}

function diagnoseConnectionFailure(input: {
    stdout: string;
    stderr: string;
}): import('../AgentAdapter.js').AgentConnectionFailureDiagnostic | undefined {
    const text = `${input.stdout}\n${input.stderr}`;
    if (/login required|not logged in|authenticate|authentication failed|sign in/i.test(text)) {
        return {
            kind: 'auth-failed',
            summary: 'Copilot CLI is not authenticated.',
            detail: 'Run `copilot login` in the Mission runtime environment, then retry the connection test.',
            diagnosticCode: 'copilot-auth'
        };
    }
    return undefined;
}
