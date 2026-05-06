import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { getDaemonLockPath, getDaemonRuntimePath } from './daemonPaths.js';
import { MissionRegistry } from './MissionRegistry.js';
import { executeEntityCommandInDaemon } from '../entities/Entity/EntityRemote.js';
import { startMissionDaemon } from './DaemonIpcServer.js';
import { connectDaemon } from './client/connectAirportDaemon.js';
import { MissionMcpSignalServer } from './runtime/agent/mcp/MissionMcpSignalServer.js';

vi.mock('./MissionTerminal.js', () => ({
    ensureMissionTerminalState: vi.fn(async () => ({
        missionId: '1-initial-setup',
        sessionId: 'mission-shell:connect-four:fixture:1-initial-setup',
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
        sessionId: 'mission-shell:connect-four:fixture:1-initial-setup',
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
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-singleton-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-singleton-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        const socketPath = path.join(runtimeRoot, 'daemon.sock');
        const daemon = await startMissionDaemon({
            socketPath,
            surfacePath: workspaceRoot
        });

        try {
            await expect(startMissionDaemon({
                socketPath,
                surfacePath: workspaceRoot
            })).rejects.toThrow(/Mission daemon is already running with pid/u);
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
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-stale-lock-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-stale-lock-runtime-'));
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

        const daemon = await startMissionDaemon({
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

    it('terminates a live but unreachable daemon lock owner before starting', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-unreachable-lock-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-unreachable-lock-runtime-'));
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

        const daemon = await startMissionDaemon({
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

    it('returns a mission terminal snapshot for mission entity ensure requests', async () => {
        const context = createMissionTerminalContext();
        const result = await executeEntityCommandInDaemon({
            entity: 'Mission',
            method: 'ensureTerminal',
            payload: { missionId: '1-initial-setup' }
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
            payload: { missionId: '1-initial-setup' }
        }, context);

        const result = await executeEntityCommandInDaemon({
            entity: 'Mission',
            method: 'sendTerminalInput',
            payload: {
                missionId: '1-initial-setup',
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

    it('starts and stops the daemon-owned MCP signal server with daemon lifecycle', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-mcp-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-mcp-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        const startSpy = vi.spyOn(MissionMcpSignalServer.prototype, 'start');
        const stopSpy = vi.spyOn(MissionMcpSignalServer.prototype, 'stop');

        const daemon = await startMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            expect(startSpy).toHaveBeenCalledTimes(1);
            expect(stopSpy).not.toHaveBeenCalled();
        } finally {
            await daemon.dispose();
            expect(stopSpy).toHaveBeenCalledTimes(1);
            startSpy.mockRestore();
            stopSpy.mockRestore();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('serves MCP tool listing from the daemon-owned singleton without lazy restart', async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-mcp-list-workspace-'));
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-mcp-list-runtime-'));
        const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
        process.env['XDG_RUNTIME_DIR'] = runtimeRoot;
        const hydrateDaemonMissions = vi.spyOn(MissionRegistry.prototype, 'hydrateDaemonMissions').mockResolvedValue(undefined);
        const fakeHandle = {
            serverId: 'server-1',
            endpoint: 'mission-local://mcp-signal/server-1',
            localOnly: true as const,
            transport: 'in-memory-local' as const,
            toolNames: ['progress', 'entity'] as const,
            listTools: async () => ['progress', 'entity'],
            healthCheck: async () => ({
                serverId: 'server-1',
                endpoint: 'mission-local://mcp-signal/server-1',
                running: true,
                localOnly: true as const,
                transport: 'in-memory-local' as const,
                registeredSessionCount: 0
            }),
            invokeTool: async () => ({ accepted: false, outcome: 'rejected' as const, reason: 'unused' })
        };
        const startSpy = vi.spyOn(MissionMcpSignalServer.prototype, 'start').mockResolvedValue(fakeHandle as never);
        const getStartedHandleSpy = vi.spyOn(MissionMcpSignalServer.prototype, 'getStartedHandle').mockReturnValue(fakeHandle as never);

        const daemon = await startMissionDaemon({
            socketPath: path.join(runtimeRoot, 'daemon.sock'),
            surfacePath: workspaceRoot
        });

        try {
            const client = await connectDaemon({
                surfacePath: workspaceRoot
            });
            try {
                const result = await client.request<{ tools: string[] }>('mcp.tools.list');
                expect(result.tools).toEqual(['progress', 'entity']);
                expect(startSpy).toHaveBeenCalledTimes(1);
                expect(getStartedHandleSpy).toHaveBeenCalledTimes(1);
            } finally {
                client.dispose();
            }
        } finally {
            await daemon.dispose();
            startSpy.mockRestore();
            getStartedHandleSpy.mockRestore();
            hydrateDaemonMissions.mockRestore();
            restoreRuntimeDirectory(previousRuntimeDirectory);
            await fs.rm(runtimeRoot, { recursive: true, force: true });
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    function createMissionTerminalContext() {
        const mission = {
            ensureTerminal: vi.fn(async (payload: { missionId: string }) => ({
                missionId: payload.missionId,
                connected: true,
                dead: false,
                exitCode: null,
                screen: '$ '
            })),
            sendTerminalInput: vi.fn(async (payload: { missionId: string }) => ({
                missionId: payload.missionId,
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
