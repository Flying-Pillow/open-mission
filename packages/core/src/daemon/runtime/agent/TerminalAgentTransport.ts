import { spawn as spawnPty } from 'node-pty';
import { TerminalRegistry } from '../terminal/TerminalRegistry.js';
import type {
    TerminalExecutor,
    TerminalOpenSessionRequest,
    TerminalProcessController,
    TerminalRegistryOptions,
    TerminalSessionHandle,
    TerminalSessionSnapshot,
    TerminalSessionState,
    TerminalSessionUpdate
} from '../terminal/Terminal.js';
import type { TerminalScreenFactory } from '../terminal/TerminalScreen.js';

export type {
    TerminalExecutor,
    TerminalExecutorResult,
    TerminalOpenSessionRequest,
    TerminalProcessController,
    TerminalProcessLease,
    TerminalSessionHandle,
    TerminalSessionOwner,
    TerminalSessionSnapshot,
    TerminalSessionState,
    TerminalSessionUpdate
} from '../terminal/Terminal.js';

export { TerminalRegistry as DaemonTerminalRegistry } from '../terminal/TerminalRegistry.js';
export {
    PlainTerminalScreen,
    createPlainTerminalScreen,
    type TerminalScreen,
    type TerminalScreenFactory,
    type TerminalScreenSerializedState,
    type TerminalScreenSnapshot
} from '../terminal/TerminalScreen.js';

export type TerminalAgentTransportOptions = {
    terminalBinary?: string;
    logLine?: (line: string) => void;
    executor?: TerminalExecutor;
    sharedSessionName?: string;
    agentSessionPaneTitle?: string;
    discoverSharedSessionName?: boolean;
    spawn?: typeof spawnPty;
    processController?: TerminalProcessController;
    terminationGraceMs?: number;
    terminationPollIntervalMs?: number;
    screenFactory?: TerminalScreenFactory;
};

export class TerminalAgentTransport {
    private static registryBySpawn = new WeakMap<typeof spawnPty, TerminalRegistry>();

    private readonly registry: TerminalRegistry;

    public constructor(options: TerminalAgentTransportOptions = {}) {
        const spawnImpl = options.spawn ?? spawnPty;
        this.registry = TerminalAgentTransport.getOrCreateRegistry(spawnImpl, options);
    }

    public static onDidSessionUpdate(
        listener: (event: TerminalSessionUpdate) => void,
        options: { spawn?: typeof spawnPty } = {}
    ): { dispose(): void } {
        return TerminalAgentTransport.getOrCreateRegistry(options.spawn ?? spawnPty).onDidSessionUpdate(listener);
    }

    public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
        return {
            available: true,
            detail: 'node-pty runtime is available.'
        };
    }

    public async openSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
        return this.registry.openSession(request);
    }

    public async attachSession(
        sessionName: string,
        _options: { sharedSessionName?: string | undefined; paneId?: string | undefined } = {}
    ): Promise<TerminalSessionHandle | undefined> {
        return this.registry.attachSession(sessionName);
    }

    public async hasSession(sessionName: string): Promise<boolean> {
        return this.registry.hasSession(sessionName);
    }

    public async sendKeys(handle: TerminalSessionHandle, keys: string, options: { literal?: boolean } = {}): Promise<void> {
        this.registry.sendKeys(handle.sessionName, keys, options);
    }

    public async resizeSession(handle: TerminalSessionHandle, cols: number, rows: number): Promise<void> {
        this.registry.resize(handle.sessionName, cols, rows);
    }

    public async capturePane(handle: TerminalSessionHandle, _startLine = -200): Promise<string> {
        return this.registry.readSnapshot(handle.sessionName)?.screen ?? '';
    }

    public async readPaneState(handle: TerminalSessionHandle): Promise<TerminalSessionState> {
        const snapshot = this.registry.readSnapshot(handle.sessionName);
        if (!snapshot) {
            return {
                dead: true,
                exitCode: 1
            };
        }
        return {
            dead: snapshot.dead,
            exitCode: snapshot.exitCode
        };
    }

    public async readSnapshot(handle: TerminalSessionHandle): Promise<TerminalSessionSnapshot> {
        const snapshot = this.registry.readSnapshot(handle.sessionName);
        if (!snapshot) {
            return {
                sessionName: handle.sessionName,
                paneId: handle.paneId,
                connected: false,
                dead: true,
                exitCode: null,
                screen: '',
                truncated: false
            };
        }
        return snapshot;
    }

    public async killSession(handle: TerminalSessionHandle): Promise<TerminalSessionState> {
        return this.registry.killSession(handle.sessionName);
    }

    private static getOrCreateRegistry(
        spawnImpl: typeof spawnPty,
        options: Pick<TerminalAgentTransportOptions, 'logLine' | 'processController' | 'terminationGraceMs' | 'terminationPollIntervalMs' | 'screenFactory'> = {}
    ): TerminalRegistry {
        const existing = this.registryBySpawn.get(spawnImpl);
        if (existing) {
            return existing;
        }
        const created = new TerminalRegistry(toRegistryOptions(spawnImpl, options));
        this.registryBySpawn.set(spawnImpl, created);
        return created;
    }
}

function toRegistryOptions(
    spawnImpl: typeof spawnPty,
    options: Pick<TerminalAgentTransportOptions, 'logLine' | 'processController' | 'terminationGraceMs' | 'terminationPollIntervalMs' | 'screenFactory'>
): TerminalRegistryOptions {
    return {
        spawnImpl,
        ...(options.logLine ? { logLine: options.logLine } : {}),
        ...(options.processController ? { processController: options.processController } : {}),
        ...(options.terminationGraceMs !== undefined ? { terminationGraceMs: options.terminationGraceMs } : {}),
        ...(options.terminationPollIntervalMs !== undefined ? { terminationPollIntervalMs: options.terminationPollIntervalMs } : {}),
        ...(options.screenFactory ? { screenFactory: options.screenFactory } : {})
    };
}
