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