import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../../entities/Agent/Agent.js';
import { AgentRegistry } from '../../../../entities/Agent/AgentRegistry.js';
import type {
    AgentCommand,
    AgentExecutionEvent,
    AgentExecutionSnapshot,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { createAgentAdapter, type AgentAdapter } from '../AgentAdapter.js';
import { AgentExecutor } from '../AgentExecutor.js';
import { MissionMcpServer } from '../mcp/MissionMcpServer.js';
import { createMemoryAgentExecutionJournalWriter } from '../testing/createMemoryAgentExecutionJournalWriter.js';
import { createCodex } from './Codex.js';

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
    submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
    terminate(reason?: string): Promise<AgentExecutionSnapshot>;
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
        submitPrompt: (prompt) => executor.submitPrompt(agentExecutionId, prompt),
        submitCommand: (command) => executor.submitCommand(agentExecutionId, command),
        terminate: (reason) => executor.terminateExecution(agentExecutionId, reason)
    };
}

describe('Codex', () => {
    let state: MockTerminalState;
    let runtimeDirectory: string;
    let codexScriptPath: string;

    beforeEach(async () => {
        vi.useFakeTimers();
        runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-codex-cli-'));
        codexScriptPath = path.join(runtimeDirectory, 'codex');
        await fs.writeFile(codexScriptPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o755 });
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

    it('starts with agent-execution-scoped mission-mcp configuration overrides', async () => {
        const adapter = createAgentAdapter(createCodex({
            command: 'codex',
            env: { PATH: runtimeDirectory },
            spawn: createSpawn(state, () => createFakePty(state))
        }), {
            resolveSettings: () => ({
                model: 'gpt-5-codex',
                runtimeEnv: { PATH: runtimeDirectory }
            })
        });

        const execution = await startExecution(adapter, createLaunchConfig());
        const snapshot = execution.getSnapshot();
        const configOverrides = readCodexConfigOverrides(state.spawnedArgs);

        expect(snapshot.agentId).toBe('codex');
        expect(snapshot.transport?.kind).toBe('terminal');
        expect(state.spawnedCommand).toBe('/bin/sh');
        expect(state.spawnedArgs).toContain(codexScriptPath);
        expect(state.spawnedArgs).toContain('--no-alt-screen');
        expect(state.spawnedArgs).toContain('--model');
        expect(state.spawnedArgs).toContain('gpt-5-codex');
        expect(configOverrides).toContain('mcp_servers."mission-mcp".command="mission"');
        expect(configOverrides).toContain(`mcp_servers."mission-mcp".args=["mcp","connect","--agent-execution","${snapshot.agentExecutionId}"]`);
        expect(configOverrides.some((override) => override.startsWith('mcp_servers."mission-mcp".env.MISSION_MCP_TOKEN='))).toBe(true);
        expect(state.spawnedArgs.some((arg) => arg.includes('Structured status markers'))).toBe(false);
        expect(state.spawnedArgs.some((arg) => arg.includes('Structured status tools'))).toBe(true);
        expect(state.spawnedArgs.some((arg) => arg.includes('@task::'))).toBe(false);
        expect(state.writes).not.toContain('Implement the task.');
    });

    it('uses the source Mission CLI bridge for MCP config in source runtime mode', async () => {
        vi.stubEnv('MISSION_DAEMON_RUNTIME_MODE', 'source');
        const adapter = createAgentAdapter(createCodex({
            command: 'codex',
            env: { PATH: runtimeDirectory },
            spawn: createSpawn(state, () => createFakePty(state))
        }), {
            resolveSettings: () => ({
                model: 'gpt-5-codex',
                runtimeEnv: { PATH: runtimeDirectory }
            })
        });

        const execution = await startExecution(adapter, createLaunchConfig());
        const snapshot = execution.getSnapshot();
        const configOverrides = readCodexConfigOverrides(state.spawnedArgs);

        expect(configOverrides).toContain('mcp_servers."mission-mcp".command="pnpm"');
        expect(configOverrides).toContain(`mcp_servers."mission-mcp".args=["--dir","/mission","--filter","@flying-pillow/mission","exec","tsx","--tsconfig","./tsconfig.dev.json","./src/mission.ts","mcp","connect","--agent-execution","${snapshot.agentExecutionId}"]`);
    });

    it('fails fast when Codex is not logged in', async () => {
        await fs.writeFile(
            codexScriptPath,
            '#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then\n  echo "Not logged in" >&2\n  exit 1\nfi\nexit 0\n',
            { encoding: 'utf8', mode: 0o755 }
        );

        const adapter = createAgentAdapter(createCodex({
            command: 'codex',
            env: { PATH: runtimeDirectory },
            spawn: createSpawn(state, () => createFakePty(state))
        }), {
            resolveSettings: () => ({
                model: 'gpt-5-codex',
                runtimeEnv: { PATH: runtimeDirectory }
            })
        });

        await expect(startExecution(adapter, createLaunchConfig())).rejects.toThrow(
            'Codex is not logged in. Run `codex login` in the Mission runtime environment, then retry the AgentExecution.'
        );
        expect(state.spawnedArgs).toEqual([]);
    });
});

type FakePty = IPty & {
    writes: string[];
    killCount: number;
    emitExit(exitCode?: number): void;
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
        emitExit(exitCode = 0) {
            onExitListener?.({ exitCode });
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

function readCodexConfigOverrides(args: string[]): string[] {
    const overrides: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index + 1];
        if (args[index] === '-c' && value) {
            overrides.push(value);
        }
    }
    return overrides;
}