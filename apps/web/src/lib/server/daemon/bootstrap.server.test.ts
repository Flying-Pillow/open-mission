import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOpenMissionDaemonProcessStatus = vi.fn();
const startOpenMissionDaemonProcess = vi.fn();
const resolveSurfacePath = vi.fn();

vi.mock('@flying-pillow/open-mission-core/daemon/runtime/DaemonProcessControl', () => ({
    getOpenMissionDaemonProcessStatus,
    startOpenMissionDaemonProcess
}));

vi.mock('./context.server', () => ({
    resolveSurfacePath
}));

describe('startOpenMissionDaemonBootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        delete process.env['OPEN_MISSION_DAEMON_BOOTSTRAP'];
        delete process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE'];
        getOpenMissionDaemonProcessStatus.mockResolvedValue({
            running: false,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Open Mission daemon is not running.'
        });
        resolveSurfacePath.mockReturnValue('/mission');
        startOpenMissionDaemonProcess.mockResolvedValue({
            running: true,
            started: true,
            alreadyRunning: false,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Open Mission daemon is running.'
        });
    });

    it('does not start another daemon when one is already reachable', async () => {
        getOpenMissionDaemonProcessStatus.mockResolvedValueOnce({
            running: true,
            manifestPath: '/tmp/mission/daemon.json',
            message: 'Open Mission daemon is running.'
        });

        const { startOpenMissionDaemonBootstrap } = await import('./bootstrap.server');
        await startOpenMissionDaemonBootstrap();

        expect(startOpenMissionDaemonProcess).not.toHaveBeenCalled();
    });

    it('starts the daemon in the background when unavailable', async () => {
        process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE'] = 'source';

        const { startOpenMissionDaemonBootstrap } = await import('./bootstrap.server');
        await startOpenMissionDaemonBootstrap();

        expect(startOpenMissionDaemonProcess).toHaveBeenCalledWith({
            surfacePath: '/mission',
            runtimeMode: 'source'
        });
    });

    it('can be disabled for hosts that manage daemon startup elsewhere', async () => {
        process.env['OPEN_MISSION_DAEMON_BOOTSTRAP'] = '0';

        const { startOpenMissionDaemonBootstrap } = await import('./bootstrap.server');
        expect(startOpenMissionDaemonBootstrap()).toBeUndefined();

        expect(getOpenMissionDaemonProcessStatus).not.toHaveBeenCalled();
        expect(startOpenMissionDaemonProcess).not.toHaveBeenCalled();
    });
});
