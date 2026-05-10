import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import { describe, expect, it, vi } from 'vitest';
import { TerminalRegistry } from './TerminalRegistry.js';

describe('TerminalRegistry', () => {
    it('terminates live terminals and clears listeners when disposed', async () => {
        const pty = createFakePty();
        const registry = new TerminalRegistry({
            spawnImpl: vi.fn(() => pty) as never
        });
        const listener = vi.fn();
        registry.onDidTerminalUpdate(listener);

        registry.openTerminal({
            workingDirectory: process.cwd(),
            command: 'node',
            args: ['--version'],
            terminalName: 'dispose-test'
        });

        await registry.dispose();
        pty.write('after-dispose');

        expect(pty.killSignals).toContain('SIGTERM');
        expect(registry.readSnapshot('dispose-test')).toBeUndefined();
        expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ chunk: 'after-dispose' }));
    });

    it('persists live terminal leases and removes them after exit', async () => {
        const pty = createFakePty();
        const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-terminal-leases-'));
        const statePath = path.join(runtimeRoot, 'daemon-terminal-leases.json');
        const registry = new TerminalRegistry({
            spawnImpl: vi.fn(() => pty) as never,
            daemonProcessId: 4242,
            persistedLeaseStatePath: statePath,
        });

        try {
            registry.openTerminal({
                workingDirectory: process.cwd(),
                command: 'node',
                args: ['--version'],
                terminalName: 'persisted-terminal',
                owner: {
                    kind: 'agent-execution',
                    ownerId: 'repository:mission',
                    agentExecutionId: 'agent-123',
                },
            });

            const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
                daemonProcessId: number;
                terminals: Array<{ terminalName: string }>;
            };
            expect(persisted.daemonProcessId).toBe(4242);
            expect(persisted.terminals).toEqual([
                expect.objectContaining({ terminalName: 'persisted-terminal' }),
            ]);

            pty.kill('SIGTERM');

            expect(fs.existsSync(statePath)).toBe(false);
        } finally {
            await registry.dispose();
            fs.rmSync(runtimeRoot, { recursive: true, force: true });
        }
    });

    it('projects live terminal leases into a runtime supervision snapshot', async () => {
        const pty = createFakePty();
        const registry = new TerminalRegistry({
            spawnImpl: vi.fn(() => pty) as never,
            daemonProcessId: 4242,
        });

        try {
            registry.openTerminal({
                workingDirectory: process.cwd(),
                command: 'node',
                args: ['--version'],
                terminalName: 'supervised-terminal',
                owner: {
                    kind: 'agent-execution',
                    ownerId: 'mission-123',
                    agentExecutionId: 'agent-123',
                },
            });

            const snapshot = registry.readRuntimeSupervisionSnapshot({
                startedAt: '2026-05-10T00:00:00.000Z'
            });

            expect(snapshot).toMatchObject({
                daemonProcessId: 4242,
                startedAt: '2026-05-10T00:00:00.000Z',
                owners: [{
                    kind: 'agent-execution',
                    ownerId: 'mission-123',
                    agentExecutionId: 'agent-123',
                }],
                leases: [{
                    leaseId: 'terminal:supervised-terminal:pty',
                    kind: 'terminal',
                    state: 'active',
                    terminalName: 'supervised-terminal',
                    processId: process.pid,
                    owner: {
                        kind: 'agent-execution',
                        ownerId: 'mission-123',
                        agentExecutionId: 'agent-123',
                    },
                }],
                relationships: [{
                    parent: {
                        kind: 'agent-execution',
                        ownerId: 'mission-123',
                        agentExecutionId: 'agent-123',
                    },
                    child: {
                        kind: 'runtime-lease',
                        leaseId: 'terminal:supervised-terminal:pty',
                    },
                    relationship: 'owns-runtime-lease',
                }],
            });
        } finally {
            await registry.dispose();
        }
    });

    it('kills persisted stale terminal leases when the owning daemon is gone', () => {
        const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-terminal-stale-leases-'));
        const statePath = path.join(runtimeRoot, 'daemon-terminal-leases.json');
        fs.writeFileSync(statePath, `${JSON.stringify({
            daemonProcessId: 999999,
            updatedAt: '2026-05-10T00:00:00.000Z',
            terminals: [{
                terminalName: 'persisted-terminal',
                terminalPaneId: 'pty',
                workingDirectory: '/tmp/workspace',
                processLease: {
                    pid: 31415,
                    processGroupId: 31415,
                    command: 'node',
                    args: ['agent.js'],
                    workingDirectory: '/tmp/workspace',
                    startedAt: '2026-05-10T00:00:00.000Z',
                },
                owner: {
                    kind: 'agent-execution',
                    ownerId: 'repository:mission',
                    agentExecutionId: 'agent-123',
                },
            }],
        }, null, 2)}\n`, 'utf8');
        const processController = {
            isProcessRunning: vi.fn(() => false),
            killProcess: vi.fn(),
            killProcessGroup: vi.fn(),
        };

        try {
            TerminalRegistry.cleanupPersistedLeases({
                statePath,
                processController,
            });

            expect(processController.killProcessGroup).toHaveBeenCalledWith(31415, 'SIGTERM');
            expect(processController.killProcessGroup).toHaveBeenCalledWith(31415, 'SIGKILL');
            expect(fs.existsSync(statePath)).toBe(false);
        } finally {
            fs.rmSync(runtimeRoot, { recursive: true, force: true });
        }
    });
});

type FakePty = IPty & {
    killSignals: (NodeJS.Signals | undefined)[];
    write(data: string): void;
};

function createFakePty(): FakePty {
    let onDataListener: ((chunk: string) => void) | undefined;
    let onExitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    const fakePty = {
        pid: process.pid,
        process: 'fake-terminal',
        cols: 120,
        rows: 32,
        handleFlowControl: false,
        killSignals: [] as (NodeJS.Signals | undefined)[],
        write(data: string) {
            onDataListener?.(data);
        },
        resize() { },
        kill(signal?: NodeJS.Signals) {
            fakePty.killSignals.push(signal);
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
        listeners() {
            return [];
        },
        rawListeners() {
            return [];
        },
        emit() {
            return true;
        },
        listenerCount() {
            return 0;
        },
        prependListener() {
            return fakePty;
        },
        prependOnceListener() {
            return fakePty;
        },
        eventNames() {
            return [];
        }
    } as FakePty;
    return fakePty;
}