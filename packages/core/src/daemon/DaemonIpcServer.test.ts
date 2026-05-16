import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { DaemonClient } from './client/DaemonClient.js';
import { getDaemonLockPath, getDaemonRuntimePath, getDaemonTerminalLeaseStatePath } from './daemonPaths.js';
import { MissionRegistry } from './MissionRegistry.js';
import { executeEntityCommandInDaemon } from './DaemonEntityDispatcher.js';
import { startOpenMissionDaemon } from './DaemonIpcServer.js';
import { Repository } from '../entities/Repository/Repository.js';

vi.mock('./MissionTerminal.js', () => ({
    ensureMissionTerminalState: vi.fn(async () => ({
        missionId: '1-initial-setup',
        connected: true,
        dead: false,
        exitCode: null,
        screen: '$ ',
        terminalHandle: {
            terminalName: 'mission-shell:connect-four:fixture:1-initial-setup',
            terminalPaneId: 'pty'
        }
    })),
    sendMissionTerminalInput: vi.fn(async () => ({
        missionId: '1-initial-setup',
        connected: true,
        dead: false,
        exitCode: null,
        screen: '$ printf daemon-terminal-test\ndaemon-terminal-test\n$ ',
        terminalHandle: {
            terminalName: 'mission-shell:connect-four:fixture:1-initial-setup',
            terminalPaneId: 'pty'
        }
    })),
    observeMissionTerminalUpdates: vi.fn(() => ({ dispose: vi.fn() }))
}));

describe('minimal source daemon request handling', () => {
    it('refuses to start a second daemon while one process owns the runtime', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-singleton-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-singleton-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        const socketPath = path.join(runtimeRoot, 'daemon.sock');
        const daemon = await startOpenMissionDaemon({
            socketPath,
            surfacePath: workspaceRoot
        });

        try {
            await expect(startOpenMissionDaemon({
                socketPath,
                surfacePath: workspaceRoot
            })).rejects.toThrow(/Open Mission daemon is already running with pid/u);
            expect(hydrateDaemonMissions).toHaveBeenCalledTimes(1);
        } finally {
            await daemon.dispose();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('replaces a stale daemon runtime lock before starting', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-stale-lock-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-stale-lock-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
        await fs.writeFile(getDaemonLockPath(), `${JSON.stringify({
            lockPath: getDaemonLockPath(),
            processId: 999999999,
            createdAt: '2026-05-04T00:00:00.000Z',
            socketPath: path.join(runtimeRoot, 'daemon.sock')
        }, null, 2)}\n`, 'utf8');

        const daemon = await startOpenMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            await expect(fs.readFile(getDaemonLockPath(), 'utf8')).resolves.toContain(`"processId": ${String(process.pid)}`);
        } finally {
            await daemon.dispose();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('starts code intelligence against the external SurrealDB database', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-surreal-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-surreal-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        vi.spyOn(Repository, 'resolve').mockResolvedValue({
            repositoryRootPath: workspaceRoot
        } as never);
        const daemon = await startOpenMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            expect(daemon).toBeDefined();
        } finally {
            await daemon.dispose();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('terminates a live but unreachable daemon lock owner before starting', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-unreachable-lock-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-unreachable-lock-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const staleProcess = spawnStaleDaemonProcess();
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
        await fs.writeFile(getDaemonLockPath(), `${JSON.stringify({
            lockPath: getDaemonLockPath(),
            processId: staleProcess.pid,
            createdAt: '2026-05-04T00:00:00.000Z',
            socketPath: path.join(runtimeRoot, 'missing-daemon.sock')
        }, null, 2)}\n`, 'utf8');

        const daemon = await startOpenMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            await expect(waitForChildExit(staleProcess)).resolves.toBe(true);
            await expect(fs.readFile(getDaemonLockPath(), 'utf8')).resolves.toContain(`"processId": ${String(process.pid)}`);
        } finally {
            await daemon.dispose();
            terminateChild(staleProcess);
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('reaps stale persisted terminal leases before starting a new daemon', async () => {
        if (process.platform === 'win32') {
            return;
        }

        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-stale-terminal-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-stale-terminal-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const staleTerminalProcess = spawnDetachedStaleTerminalProcess();
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        await fs.mkdir(getDaemonRuntimePath(), { recursive: true });
        await fs.writeFile(getDaemonTerminalLeaseStatePath(), `${JSON.stringify({
            daemonProcessId: 999999999,
            updatedAt: '2026-05-04T00:00:00.000Z',
            terminals: [{
                terminalName: 'mission-agent-stale',
                terminalPaneId: 'pty',
                workingDirectory: workspaceRoot,
                processLease: {
                    pid: staleTerminalProcess.pid,
                    processGroupId: staleTerminalProcess.pid,
                    command: process.execPath,
                    args: ['-e', 'setInterval(() => undefined, 1000);'],
                    workingDirectory: workspaceRoot,
                    startedAt: '2026-05-04T00:00:00.000Z',
                },
                owner: {
                    kind: 'agent-execution',
                    ownerId: 'repository:mission',
                    agentExecutionId: 'stale-agent',
                },
            }],
        }, null, 2)}\n`, 'utf8');

        const daemon = await startOpenMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            await expect(waitForChildExit(staleTerminalProcess)).resolves.toBe(true);
            await expect(fs.readFile(getDaemonTerminalLeaseStatePath(), 'utf8')).rejects.toThrow();
        } finally {
            await daemon.dispose();
            terminateChild(staleTerminalProcess);
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('returns a mission terminal snapshot for mission entity ensure requests', async () => {
        const context = createMissionTerminalContext();
        const result = await executeEntityCommandInDaemon({
            entity: 'Mission',
            method: 'ensureTerminal',
            id: 'mission:1-initial-setup',
            payload: {}
        }, context);

        expect(result).toMatchObject({
            missionId: '1-initial-setup',
            connected: true,
            dead: false,
            exitCode: null,
            screen: expect.any(String)
        });
    });

    it('returns a mission terminal snapshot for mission entity input requests after explicit ensure', async () => {
        const context = createMissionTerminalContext();
        await executeEntityCommandInDaemon({
            entity: 'Mission',
            method: 'ensureTerminal',
            id: 'mission:1-initial-setup',
            payload: {}
        }, context);

        const result = await executeEntityCommandInDaemon({
            entity: 'Mission',
            method: 'sendTerminalInput',
            id: 'mission:1-initial-setup',
            payload: {
                data: 'printf daemon-terminal-test\n'
            }
        }, context);

        expect(result).toMatchObject({
            missionId: '1-initial-setup',
            connected: true,
            dead: false,
            exitCode: null,
            screen: expect.any(String)
        });
    });

    it('starts and owns an Impeccable live server through the daemon transport', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-impeccable-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-daemon-impeccable-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        const resolveRepository = vi.spyOn(Repository, 'resolve').mockResolvedValue({
            repositoryRootPath: workspaceRoot
        } as never);
        const daemon = await startOpenMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });
        const client = new DaemonClient();

        try {
            await client.connect({
                surfacePath: workspaceRoot,
                socketPath: daemon.socketPath,
                timeoutMs: 5_000
            });
            const session = await client.request<{ origin: string }>('impeccable-live.resolve', {
                repositoryId: 'repository:github/Flying-Pillow/open-mission'
            }, {
                timeoutMs: 15_000
            });

            expect(session.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
            const serverInfoPath = path.join(workspaceRoot, '.impeccable', 'live', 'server.json');
            await expect(fs.readFile(serverInfoPath, 'utf8')).resolves.toContain(session.origin);
            await expect(client.request<{ stopped: boolean }>('impeccable-live.stop', {
                repositoryId: 'repository:github/Flying-Pillow/open-mission'
            }, {
                timeoutMs: 10_000
            })).resolves.toEqual({ stopped: true });
            await expect(client.request<{ stopped: boolean }>('impeccable-live.stop', {
                repositoryId: 'repository:github/Flying-Pillow/open-mission'
            }, {
                timeoutMs: 10_000
            })).resolves.toEqual({ stopped: false });
        } finally {
            client.dispose();
            await daemon.dispose();
            resolveRepository.mockRestore();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    function createMissionTerminalContext() {
        const missionId = '1-initial-setup';
        const mission = {
            ensureTerminal: vi.fn(async () => ({
                missionId,
                connected: true,
                dead: false,
                exitCode: null,
                screen: '$ '
            })),
            sendTerminalInput: vi.fn(async () => ({
                missionId,
                connected: true,
                dead: false,
                exitCode: null,
                screen: '$ printf daemon-terminal-test\ndaemon-terminal-test\n$ '
            }))
        };
        const missionRegistry = new MissionRegistry();
        vi.spyOn(missionRegistry, 'loadRequiredMission').mockResolvedValue(mission as never);
        return {
            surfacePath: '/repositories/Flying-Pillow/connect-four',
            missionRegistry
        };
    }
});

function spawnStaleDaemonProcess(): ChildProcess & { pid: number } {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000);'], {
        stdio: 'ignore'
    });
    if (!child.pid) {
        throw new Error('Failed to spawn stale daemon fixture process.');
    }
    return child as ChildProcess & { pid: number };
}

function spawnDetachedStaleTerminalProcess(): ChildProcess & { pid: number } {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000);'], {
        stdio: 'ignore',
        detached: true,
    });
    if (!child.pid) {
        throw new Error('Failed to spawn detached stale terminal fixture process.');
    }
    child.unref();
    return child as ChildProcess & { pid: number };
}

async function waitForChildExit(child: ChildProcess): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return true;
    }
    return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 3_000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

function terminateChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    child.kill('SIGKILL');
}

function restoreRuntimeDirectory(previousRuntimeDirectory: string | undefined): void {
    if (previousRuntimeDirectory === undefined) {
        delete process.env['XDG_RUNTIME_DIR'];
        return;
    }

    process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
}
