import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMissionDaemonProcessStatus = vi.fn();
const resolveDefaultRuntimeFactoryModulePath = vi.fn();
const startMissionDaemonProcess = vi.fn();
const resolveSurfacePath = vi.fn();

vi.mock('@flying-pillow/mission-core/daemon/runtime/DaemonProcessControl', () => ({
    getMissionDaemonProcessStatus,
    resolveDefaultRuntimeFactoryModulePath,
    startMissionDaemonProcess
}));

vi.mock('./context.server', () => ({
    resolveSurfacePath
}));

describe('startMissionDaemonBootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        delete process.env['MISSION_AIRPORT_DAEMON_BOOTSTRAP'];
        delete process.env['MISSION_DAEMON_RUNTIME_MODE'];
        getMissionDaemonProcessStatus.mockResolvedValue({
            running: false,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Mission daemon is not running.'
        });
        resolveDefaultRuntimeFactoryModulePath.mockReturnValue('/mission/packages/core/build/daemon/runtime/agent/adapters/AgentAdapterFactory.js');
        resolveSurfacePath.mockReturnValue('/mission');
        startMissionDaemonProcess.mockResolvedValue({
            running: true,
            started: true,
            alreadyRunning: false,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Mission daemon is running.'
        });
    });

    it('does not start another daemon when one is already reachable', async () => {
        getMissionDaemonProcessStatus.mockResolvedValueOnce({
            running: true,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Mission daemon is running.'
        });

        const { startMissionDaemonBootstrap } = await import('./bootstrap.server');
        await startMissionDaemonBootstrap();

        expect(startMissionDaemonProcess).not.toHaveBeenCalled();
    });

    it('starts the daemon in the background when unavailable', async () => {
        process.env['MISSION_DAEMON_RUNTIME_MODE'] = 'source';

        const { startMissionDaemonBootstrap } = await import('./bootstrap.server');
        await startMissionDaemonBootstrap();

        expect(resolveDefaultRuntimeFactoryModulePath).toHaveBeenCalledWith('source');
        expect(startMissionDaemonProcess).toHaveBeenCalledWith({
            surfacePath: '/mission',
            runtimeMode: 'source',
            runtimeFactoryModulePath: '/mission/packages/core/build/daemon/runtime/agent/adapters/AgentAdapterFactory.js'
        });
    });

    it('can be disabled for hosts that manage daemon startup elsewhere', async () => {
        process.env['MISSION_AIRPORT_DAEMON_BOOTSTRAP'] = '0';

        const { startMissionDaemonBootstrap } = await import('./bootstrap.server');
        expect(startMissionDaemonBootstrap()).toBeUndefined();

        expect(getMissionDaemonProcessStatus).not.toHaveBeenCalled();
        expect(startMissionDaemonProcess).not.toHaveBeenCalled();
    });
});
