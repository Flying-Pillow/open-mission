import { beforeEach, describe, expect, it, vi } from 'vitest';

const liveProxyMocks = vi.hoisted(() => ({
    buildProxyOrigin: vi.fn(),
    proxyLiveRequest: vi.fn(),
    resolveLiveProxyContext: vi.fn(),
    rewriteLiveScriptOrigin: vi.fn()
}));

vi.mock('$lib/server/impeccable/live-proxy.server', () => liveProxyMocks);

import { GET } from './[...livePath]/+server';

describe('impeccable live proxy route', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        liveProxyMocks.resolveLiveProxyContext.mockResolvedValue({
            surfacePath: '/worktrees/repo-1',
            session: { origin: 'http://127.0.0.1:8400' }
        });
        liveProxyMocks.proxyLiveRequest.mockResolvedValue(new Response(
            "window.__IMPECCABLE_ORIGIN__ = 'http://localhost:8400';",
            {
                status: 200,
                headers: { 'content-type': 'application/javascript' }
            }
        ));
        liveProxyMocks.buildProxyOrigin.mockReturnValue('https://openmission.example/api/impeccable/live?repositoryId=repo-1');
        liveProxyMocks.rewriteLiveScriptOrigin.mockImplementation((script: string, origin: string) => `${script}\n/* ${origin} */`);
    });

    it('rewrites live.js to use the public proxy origin', async () => {
        const response = await GET({
            params: { livePath: 'live.js' },
            request: new Request('https://openmission.example/api/impeccable/live/live.js?repositoryId=repo-1'),
            url: new URL('https://openmission.example/api/impeccable/live/live.js?repositoryId=repo-1'),
            locals: {} as App.Locals
        } as Parameters<typeof GET>[0]);

        expect(liveProxyMocks.proxyLiveRequest).toHaveBeenCalledWith(expect.objectContaining({
            path: 'live.js'
        }));
        expect(liveProxyMocks.buildProxyOrigin).toHaveBeenCalledWith({
            requestUrl: new URL('https://openmission.example/api/impeccable/live/live.js?repositoryId=repo-1'),
            repositoryId: 'repo-1',
            missionId: undefined
        });
        expect(await response.text()).toContain('https://openmission.example/api/impeccable/live?repositoryId=repo-1');
    });

    it('rewrites live.js with a mission-owned selector when the worktree owner is a mission', async () => {
        liveProxyMocks.buildProxyOrigin.mockReturnValueOnce('https://openmission.example/api/impeccable/live?missionId=mission-7');

        const response = await GET({
            params: { livePath: 'live.js' },
            request: new Request('https://openmission.example/api/impeccable/live/live.js?missionId=mission-7'),
            url: new URL('https://openmission.example/api/impeccable/live/live.js?missionId=mission-7'),
            locals: {} as App.Locals
        } as Parameters<typeof GET>[0]);

        expect(liveProxyMocks.buildProxyOrigin).toHaveBeenCalledWith({
            requestUrl: new URL('https://openmission.example/api/impeccable/live/live.js?missionId=mission-7'),
            repositoryId: undefined,
            missionId: 'mission-7'
        });
        expect(await response.text()).toContain('https://openmission.example/api/impeccable/live?missionId=mission-7');
    });
});