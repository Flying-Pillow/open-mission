import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentLaunchConfig } from '../../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type { AgentAdapterLaunchPreparation, AgentExecutionMcpAccess } from '../AgentAdapter.js';

export type AgentExecutionMcpBridge = {
    command: string;
    args: string[];
    env: Record<string, string>;
};

export type AgentExecutionMcpProvisioning = {
    launchEnv?: Record<string, string>;
    cleanup?: () => Promise<void>;
};

export async function provisionAgentExecutionMcpConfig(input: {
    config: AgentLaunchConfig;
    access: AgentExecutionMcpAccess;
    launchEnvName: string;
    configFileName: string;
    createDocument: (bridge: AgentExecutionMcpBridge) => unknown;
    referenceConfigPath?: (configPath: string) => string;
}): Promise<AgentAdapterLaunchPreparation> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-agent-mcp-'));
    const configPath = path.join(directory, input.configFileName);
    const bridge = createAgentExecutionMcpBridge(input.access);
    await fs.writeFile(configPath, `${JSON.stringify(input.createDocument(bridge), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const configReference = input.referenceConfigPath?.(configPath) ?? configPath;

    return {
        config: {
            ...input.config,
            launchEnv: {
                ...(input.config.launchEnv ?? {}),
                [input.launchEnvName]: configReference
            }
        },
        cleanup: async () => {
            await fs.rm(directory, { recursive: true, force: true });
        }
    };
}

export function createAgentExecutionMcpBridge(access: AgentExecutionMcpAccess): AgentExecutionMcpBridge {
    const explicitCommand = process.env['OPEN_MISSION_CLI_COMMAND']?.trim();
    if (explicitCommand) {
        return {
            command: explicitCommand,
            args: ['mcp', 'connect', '--agent-execution', access.agentExecutionId],
            env: {
                OPEN_MISSION_AGENT_EXECUTION_OWNER_ID: access.ownerId,
                OPEN_MISSION_MCP_TOKEN: access.token
            }
        };
    }

    const sourceBridge = createSourceRuntimeBridge(access);
    if (sourceBridge) {
        return sourceBridge;
    }

    return {
        command: 'open-mission',
        args: ['mcp', 'connect', '--agent-execution', access.agentExecutionId],
        env: {
            OPEN_MISSION_AGENT_EXECUTION_OWNER_ID: access.ownerId,
            OPEN_MISSION_MCP_TOKEN: access.token
        }
    };
}

function createSourceRuntimeBridge(access: AgentExecutionMcpAccess): AgentExecutionMcpBridge | undefined {
    if (process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE']?.trim() !== 'source') {
        return undefined;
    }
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
        return undefined;
    }
    return {
        command: 'pnpm',
        args: [
            '--dir',
            workspaceRoot,
            '--filter',
            '@flying-pillow/open-mission',
            'exec',
            'tsx',
            '--tsconfig',
            './tsconfig.dev.json',
            './src/open-mission.ts',
            'mcp',
            'connect',
            '--agent-execution',
            access.agentExecutionId
        ],
        env: {
            OPEN_MISSION_AGENT_EXECUTION_OWNER_ID: access.ownerId,
            OPEN_MISSION_MCP_TOKEN: access.token,
            OPEN_MISSION_DAEMON_RUNTIME_MODE: 'source'
        }
    };
}

function resolveWorkspaceRoot(startDirectory: string): string | undefined {
    let current = path.resolve(startDirectory);
    while (true) {
        if (existsSync(path.join(current, 'pnpm-workspace.yaml'))
            && existsSync(path.join(current, 'packages', 'open-mission', 'src', 'open-mission.ts'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}
