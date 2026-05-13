import type { AgentAdapterTerminalOptions, AgentInput } from '../AgentAdapter.js';

const OPENCODE_AGENT_ID = 'opencode' as const;

export type OpenCodeInput = {
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

export function createOpenCode(input: OpenCodeInput = {}): AgentInput {
    const { command, env, ...terminalOptions } = input;
    return {
        id: `agent:${OPENCODE_AGENT_ID}`,
        agentId: OPENCODE_AGENT_ID,
        displayName: 'OpenCode',
        icon: 'lucide:code-xml',
        adapter: {
            command: command?.trim() || process.env['OPEN_MISSION_OPENCODE_CLI_COMMAND']?.trim() || 'opencode',
            providerSettings: {},
            defaultLaunchMode: 'interactive',
            transportCapabilities: {
                supported: ['stdout-marker'],
                preferred: {
                    interactive: 'stdout-marker',
                    print: 'stdout-marker'
                },
                provisioning: {
                    requiresRuntimeConfig: false,
                    supportsStdioBridge: false,
                    supportsAgentExecutionScopedTools: false
                }
            },
            ...(env ? { runtimeEnv: env } : {}),
            terminalOptions,
            interactive: {
                args: [
                    { setting: 'model', flag: '--model' },
                    { prompt: 'initial', flag: '--prompt', omitWhenEmpty: true }
                ]
            },
            print: {
                args: [
                    'run',
                    '--format',
                    'json',
                    { setting: 'model', flag: '--model' },
                    { prompt: 'initial', omitWhenEmpty: true }
                ]
            }
        }
    } satisfies AgentInput;
}

export const openCode = createOpenCode();
