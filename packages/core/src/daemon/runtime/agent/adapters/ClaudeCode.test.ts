import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../../entities/Agent/Agent.js';
import { AgentRegistry } from '../../../../entities/Agent/AgentRegistry.js';
import type {
    AgentExecutionEvent,
    AgentExecutionSnapshot,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { createAgentAdapter, type AgentAdapter } from '../AgentAdapter.js';
import { AgentExecutor } from '../AgentExecutor.js';
import { MissionMcpServer } from '../mcp/MissionMcpServer.js';
import { createMemoryAgentExecutionJournalWriter } from '../testing/createMemoryAgentExecutionJournalWriter.js';
import { createClaudeCode } from './ClaudeCode.js';

type MockTerminalState = {
    spawnedCommand: string;
    spawnedArgs: string[];
    writes: string[];
    killCount: number;
};

function createLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
    return {
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'task-1',
            stageId: 'implementation'
        },
        workingDirectory: '/tmp/work',
        task: {
            taskId: 'task-1',
            stageId: 'implementation',
            title: 'Implement the task',
            description: 'Implement the task',
            instruction: 'Implement the task.'
        },
        specification: {
            summary: 'Implement the task.',
            documents: []
        },
        resume: { mode: 'new' },
        initialPrompt: {
            source: 'engine',
            text: 'Implement the task.'
        },
        ...overrides
    };
}

type StartedTerminalExecution = {
    getSnapshot(): AgentExecutionSnapshot;
    onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void };
    submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
};

async function startExecution(
    adapter: AgentAdapter,
    config: AgentLaunchConfig
): Promise<StartedTerminalExecution> {
    const missionMcpServer = new MissionMcpServer({
        agentExecutionRegistry: {
            routeTransportObservation() {
                return {
                    status: 'recorded-only',
                    agentExecutionId: 'test-agent-execution',
                    eventId: 'test-event',
                    observationId: 'test-observation'
                };
            }
        }
    });
    await missionMcpServer.start();
    const { journalWriter } = createMemoryAgentExecutionJournalWriter();
    const executor = new AgentExecutor({
        agentRegistry: new AgentRegistry({
            agents: [await Agent.fromAdapter(adapter)]
        }),
        missionMcpServer,
        journalWriter
    });
    const execution = await executor.startExecution(config);
    const agentExecutionId = execution.getSnapshot().agentExecutionId;
    return {
        getSnapshot: () => execution.getSnapshot(),
        onDidEvent: (listener) => execution.onDidEvent(listener),
        submitPrompt: (prompt) => executor.submitPrompt(agentExecutionId, prompt)
    };
}

describe('ClaudeCode', () => {
    let state: MockTerminalState;
    let runtimeDirectory: string;
    let claudeScriptPath: string;

    beforeEach(async () => {
        vi.useFakeTimers();
        runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-claude-cli-'));
        claudeScriptPath = path.join(runtimeDirectory, 'claude');
        await fs.writeFile(claudeScriptPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });
        state = {
            spawnedCommand: '',
            spawnedArgs: [],
            writes: [],
            killCount: 0
        };
    });

    afterEach(async () => {
        await fs.rm(runtimeDirectory, { recursive: true, force: true });
        vi.unstubAllEnvs();
        vi.useRealTimers();
    });

    it('uses interactive MCP config without print-only flags', async () => {
        const adapter = createAgentAdapter(createClaudeCode({
            command: 'claude',
            env: { PATH: runtimeDirectory },
            spawn: createSpawn(state, () => createFakePty(state))
        }), {
            resolveSettings: () => ({
                model: 'claude-sonnet-4-6-20260415',
                reasoningEffort: 'high',
                runtimeEnv: { PATH: runtimeDirectory }
            })
        });

        const execution = await startExecution(adapter, createLaunchConfig());
        const snapshot = execution.getSnapshot();

        expect(snapshot.agentId).toBe('claude-code');
        expect(state.spawnedCommand).toBe('/bin/sh');
        expect(state.spawnedArgs).toContain(claudeScriptPath);
        expect(state.spawnedArgs).toContain('--model');
        expect(state.spawnedArgs).toContain('claude-sonnet-4-6-20260415');
        expect(state.spawnedArgs).toContain('--effort');
        expect(state.spawnedArgs).toContain('high');
        expect(state.spawnedArgs).toContain('--mcp-config');
        expect(state.spawnedArgs).toContain('--add-dir');
        expect(state.spawnedArgs).toContain('/tmp/work');
        expect(state.spawnedArgs).not.toContain('--print');
        expect(state.spawnedArgs).not.toContain('--output-format');

        const mcpConfigPath = state.spawnedArgs[state.spawnedArgs.indexOf('--mcp-config') + 1];
        const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath ?? '', 'utf8')) as {
            mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
        };

        expect(mcpConfig.mcpServers?.['mission-mcp']?.args).toEqual([
            'mcp',
            'connect',
            '--agent-execution',
            snapshot.agentExecutionId
        ]);
        expect(mcpConfig.mcpServers?.['mission-mcp']?.env?.['MISSION_MCP_TOKEN']).toBeTruthy();
    });
});

type FakePty = IPty & {
    writes: string[];
    killCount: number;
};

function createSpawn(
    state: MockTerminalState,
    createPty: () => FakePty
): (command: string, args: string | string[]) => FakePty {
    return ((command: string, args: string | string[]) => {
        state.spawnedCommand = command;
        state.spawnedArgs = Array.isArray(args) ? [...args] : [args];
        return createPty();
    }) as never;
}

function createFakePty(state: MockTerminalState): FakePty {
    let onDataListener: ((chunk: string) => void) | undefined;
    let onExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    const fakePty = {
        pid: 1,
        process: 'fake-shell',
        cols: 120,
        rows: 32,
        handleFlowControl: false,
        writes: [] as string[],
        killCount: 0,
        write(data: string) {
            fakePty.writes.push(data);
            state.writes.push(data);
            onDataListener?.(data);
        },
        resize() { },
        kill() {
            fakePty.killCount += 1;
            state.killCount += 1;
            onExitListener?.({ exitCode: 0 });
        },
        clear() { },
        onData(listener: (chunk: string) => void) {
            onDataListener = listener;
            return { dispose() { } };
        },
        onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
            onExitListener = listener;
            return { dispose() { } };
        },
        pause() { },
        resume() { },
        setEncoding() { },
        addListener() {
            return fakePty;
        },
        removeListener() {
            return fakePty;
        },
        once() {
            return fakePty;
        },
        removeAllListeners() {
            return fakePty;
        },
        emit() {
            return false;
        },
        eventNames() {
            return [];
        },
        getMaxListeners() {
            return 0;
        },
        listenerCount() {
            return 0;
        },
        listeners() {
            return [];
        },
        off() {
            return fakePty;
        },
        on() {
            return fakePty;
        },
        prependListener() {
            return fakePty;
        },
        prependOnceListener() {
            return fakePty;
        },
        rawListeners() {
            return [];
        },
        setMaxListeners() {
            return fakePty;
        }
    } as FakePty;
    return fakePty;
}