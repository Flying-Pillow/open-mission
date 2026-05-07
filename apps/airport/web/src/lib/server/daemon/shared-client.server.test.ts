import { beforeEach, describe, expect, it, vi } from 'vitest';

const openDaemonConnection = vi.fn();

vi.mock('./transport.server', () => ({
    openDaemonConnection
}));

describe('acquireSharedDaemonClient', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('reuses a connected client without pinging on every lease', async () => {
        const disconnectSubscription = { dispose: vi.fn() };
        const client = {
            connect: vi.fn().mockResolvedValue(undefined),
            request: vi.fn().mockResolvedValue({ ok: true }),
            onDidDisconnect: vi.fn(() => disconnectSubscription),
            dispose: vi.fn()
        };

        openDaemonConnection.mockResolvedValueOnce({ client, dispose: client.dispose });

        const { acquireSharedDaemonClient } = await import('./shared-client.server');

        const firstLease = await acquireSharedDaemonClient({
            surfacePath: '/mission'
        });
        firstLease.dispose();

        const secondLease = await acquireSharedDaemonClient({
            surfacePath: '/mission'
        });

        expect(secondLease.client).toBe(client);
        expect(openDaemonConnection).toHaveBeenCalledTimes(1);
        expect(client.connect).not.toHaveBeenCalled();
        expect(client.request).not.toHaveBeenCalled();
        expect(client.onDidDisconnect).toHaveBeenCalledTimes(1);
        secondLease.dispose();
    });

    it('evicts a cached client when the daemon socket disconnects', async () => {
        let reportDisconnect: ((error: Error) => void) | undefined;
        const staleDisconnectSubscription = { dispose: vi.fn() };
        const freshDisconnectSubscription = { dispose: vi.fn() };
        const staleClient = {
            connect: vi.fn().mockResolvedValue(undefined),
            request: vi.fn().mockResolvedValue({ ok: true }),
            onDidDisconnect: vi.fn((listener: (error: Error) => void) => {
                reportDisconnect = listener;
                return staleDisconnectSubscription;
            }),
            dispose: vi.fn()
        };
        const freshClient = {
            connect: vi.fn().mockResolvedValue(undefined),
            request: vi.fn().mockResolvedValue({ ok: true }),
            onDidDisconnect: vi.fn(() => freshDisconnectSubscription),
            dispose: vi.fn()
        };

        openDaemonConnection
            .mockResolvedValueOnce({ client: staleClient, dispose: staleClient.dispose })
            .mockResolvedValueOnce({ client: freshClient, dispose: freshClient.dispose });

        const { acquireSharedDaemonClient } = await import('./shared-client.server');

        const firstLease = await acquireSharedDaemonClient({
            surfacePath: '/mission'
        });
        firstLease.dispose();

        reportDisconnect?.(new Error('Mission daemon connection closed.'));

        expect(staleClient.dispose).toHaveBeenCalledTimes(1);
        expect(staleDisconnectSubscription.dispose).toHaveBeenCalledTimes(1);

        const recoveredLease = await acquireSharedDaemonClient({
            surfacePath: '/mission'
        });
        expect(recoveredLease.client).toBe(freshClient);
        expect(openDaemonConnection).toHaveBeenCalledTimes(2);
        recoveredLease.dispose();
    });
});
