import {
    type AgentAdapterRuntimeOutput,
    type AgentAdapterTerminalOptions,
    type AgentInput,
    getNestedRecord,
    getStringField,
    parseJsonLine
} from '../AgentAdapter.js';

const PI_AGENT_ID = 'pi' as const;

export type PiInput = {
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

export function createPi(input: PiInput = {}): AgentInput {
    const { command, env, ...terminalOptions } = input;
    return {
        id: `agent:${PI_AGENT_ID}`,
        agentId: PI_AGENT_ID,
        displayName: 'Pi',
        icon: 'lucide:pi',
        adapter: {
            command: command?.trim() || process.env['MISSION_PI_CLI_COMMAND']?.trim() || 'pi',
            providerSettings: {},
            defaultLaunchMode: 'print',
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
                    { setting: 'reasoningEffort', flag: '--thinking' },
                    { prompt: 'initial', omitWhenEmpty: true }
                ]
            },
            print: {
                args: [
                    '--print',
                    { setting: 'model', flag: '--model' },
                    { setting: 'reasoningEffort', flag: '--thinking' },
                    { prompt: 'initial', omitWhenEmpty: true }
                ]
            },
            parseRuntimeOutputLine
        }
    } satisfies AgentInput;
}

export const pi = createPi();

function parseRuntimeOutputLine(line: string): AgentAdapterRuntimeOutput[] {
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
