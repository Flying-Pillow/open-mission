import * as os from 'node:os';
import * as path from 'node:path';
import {
    type AgentInput,
    type AgentAdapterTerminalOptions
} from '../AgentAdapter.js';

const COPILOT_AGENT_ID = 'copilot-cli' as const;

export type CopilotInput = {
    command?: string;
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
    const { command, trustedConfigDir, env, ...terminalOptions } = input;
    const resolvedTrustedConfigDir = trustedConfigDir ? path.resolve(trustedConfigDir) : resolveTrustedConfigDir();
    return {
        id: `agent:${COPILOT_AGENT_ID}`,
        agentId: COPILOT_AGENT_ID,
        displayName: 'Copilot CLI',
        default: true,
        adapter: {
            command: command?.trim() || process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
            providerSettings: false,
            trustedFolders: { configDir: resolvedTrustedConfigDir },
            ...(env ? { runtimeEnv: env } : {}),
            terminalOptions,
            interactive: {
                args: [
                    '--allow-all-paths',
                    '--allow-all-tools',
                    '--allow-all-urls',
                    { trustedConfigDir: true, flag: '--config-dir' },
                    { trustedDirectories: true, flag: '--add-dir' },
                    { prompt: 'initial', flag: '-i', trim: true, omitWhenEmpty: true }
                ]
            }
        }
    };
}

export const copilot = createCopilot();

function resolveTrustedConfigDir(): string {
    const fromEnv = process.env['MISSION_COPILOT_CONFIG_DIR']?.trim();
    return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), '.mission', 'copilot-cli');
}
