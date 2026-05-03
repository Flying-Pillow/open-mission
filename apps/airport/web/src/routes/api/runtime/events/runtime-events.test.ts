import { describe, expect, it, vi } from 'vitest';

const openEventSubscription = vi.fn();
const openApplicationEventSubscription = vi.fn();

vi.mock('$lib/server/daemon/daemon-gateway', () => ({
    DaemonGateway: class {
        public openEventSubscription = openEventSubscription;
        public openApplicationEventSubscription = openApplicationEventSubscription;
    }
}));

describe('/api/runtime/events', () => {
    it('opens the application Entity event stream when scope is application', async () => {
        openEventSubscription.mockReset();
        openApplicationEventSubscription.mockReset();
        openApplicationEventSubscription.mockImplementation(async (input: {
            channels: string[];
            onEvent: (event: unknown) => void;
        }) => {
            input.onEvent({
                type: 'entity.deleted',
                entity: 'Repository',
                id: 'repository:github/Flying-Pillow/mission',
                entityId: 'repository:github/Flying-Pillow/mission',
                channel: 'repository:github/Flying-Pillow/mission.deleted',
                eventName: 'deleted',
                occurredAt: '2026-05-02T00:00:00.000Z'
            });
            return { dispose: vi.fn() };
        });

        const { GET } = await import('./+server');
        const abortController = new AbortController();
        const response = await GET({
            locals: {} as App.Locals,
            request: new Request('http://127.0.0.1:4175/api/runtime/events?scope=application', {
                signal: abortController.signal
            }),
            url: new URL('http://127.0.0.1:4175/api/runtime/events?scope=application')
        } as Parameters<typeof GET>[0]);

        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        const decoder = new TextDecoder();
        let body = '';
        for (let readCount = 0; readCount < 3 && !body.includes('event: entity'); readCount += 1) {
            const chunk = await reader!.read();
            if (chunk.done) {
                break;
            }
            body += decoder.decode(chunk.value, { stream: true });
        }
        await reader!.cancel();
        abortController.abort();

        expect(openApplicationEventSubscription).toHaveBeenCalledWith(expect.objectContaining({
            channels: ['repository:*.*']
        }));
        expect(openEventSubscription).not.toHaveBeenCalled();
        expect(body).toContain('event: entity');
        expect(body).toContain('"type":"entity.deleted"');
    });
});