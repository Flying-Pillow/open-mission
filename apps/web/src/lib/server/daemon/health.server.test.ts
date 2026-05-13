import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clearSharedDaemonClient = vi.fn();
const openDaemonConnection = vi.fn();

vi.mock('./shared-client.server', () => ({
    clearSharedDaemonClient
}));

vi.mock('./transport.server', () => ({
    openDaemonConnection
}));

describe('getDaemonRuntimeState', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the last known healthy state while a fresh daemon probe is still pending', async () => {
        openDaemonConnection.mockResolvedValueOnce({
            client: {},
            dispose: vi.fn()
        });

        const { getDaemonRuntimeState } = await import('./health.server');

        await expect(
            getDaemonRuntimeState({
                surfacePath: '/mission'
            })
        ).resolves.toMatchObject({
            running: true,
            message: 'Open Mission daemon connected.'
        });

        vi.setSystemTime(new Date('2026-05-04T10:00:03.100Z'));
        openDaemonConnection.mockImplementationOnce(
            () => new Promise(() => { })
        );

        const pendingStatePromise = getDaemonRuntimeState({
            surfacePath: '/mission',
            timeoutMs: 10
        });

        await vi.advanceTimersByTimeAsync(10);

        await expect(pendingStatePromise).resolves.toMatchObject({
            running: true,
            message: 'Open Mission daemon connected.'
        });
    });

    it('reports daemon unavailable without attempting process recovery', async () => {
        openDaemonConnection.mockRejectedValueOnce(new Error('daemon socket closed'));

        const { getDaemonRuntimeState } = await import('./health.server');

        await expect(
            getDaemonRuntimeState({
                surfacePath: '/mission'
            })
        ).resolves.toEqual({
            running: false,
            message: 'Open Mission daemon is unavailable: daemon socket closed',
            lastCheckedAt: '2026-05-04T10:00:00.000Z'
        });
        expect(openDaemonConnection).toHaveBeenCalledTimes(1);
        expect(openDaemonConnection).toHaveBeenCalledWith({
            surfacePath: '/mission'
        });
        expect(clearSharedDaemonClient).toHaveBeenCalledWith('/mission', undefined);
    });

    it('starts a fresh probe when the previous daemon health check is stale and still pending', async () => {
        openDaemonConnection.mockImplementationOnce(
            () => new Promise(() => { })
        );

        const { getDaemonRuntimeState } = await import('./health.server');

        const pendingStatePromise = getDaemonRuntimeState({
            surfacePath: '/mission',
            timeoutMs: 10
        });

        await vi.advanceTimersByTimeAsync(10);
        await expect(pendingStatePromise).resolves.toMatchObject({
            running: false,
            message: 'Open Mission daemon availability check is still in progress.'
        });

        vi.setSystemTime(new Date('2026-05-04T10:00:05.100Z'));
        openDaemonConnection.mockResolvedValueOnce({
            client: {},
            dispose: vi.fn()
        });

        await expect(
            getDaemonRuntimeState({
                surfacePath: '/mission'
            })
        ).resolves.toMatchObject({
            running: true,
            message: 'Open Mission daemon connected.'
        });
    });
});
