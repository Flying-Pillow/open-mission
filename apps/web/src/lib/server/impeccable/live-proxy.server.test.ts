import { describe, expect, it } from 'vitest';
import { buildProxyOrigin, rewriteLiveScriptOrigin } from './live-proxy.server';

describe('impeccable live proxy helpers', () => {
    it('builds a proxy origin with repository selectors', () => {
        const origin = buildProxyOrigin({
            requestUrl: new URL('https://openmission.example/app/repo-1'),
            repositoryId: 'repo-1'
        });

        expect(origin).toBe(
            'https://openmission.example/api/impeccable/live?repositoryId=repo-1'
        );
    });

    it('builds a proxy origin with mission selectors', () => {
        const origin = buildProxyOrigin({
            requestUrl: new URL('https://openmission.example/app/repo-1'),
            missionId: 'mission-7'
        });

        expect(origin).toBe(
            'https://openmission.example/api/impeccable/live?missionId=mission-7'
        );
    });

    it('replaces the live script origin assignment with the public proxy origin', () => {
        const script = [
            "window.__IMPECCABLE_TOKEN__ = 'token';",
            "window.__IMPECCABLE_PORT__ = 8400;",
            "window.__IMPECCABLE_ORIGIN__ = 'http://localhost:8400';"
        ].join('\n');

        expect(rewriteLiveScriptOrigin(script, 'https://openmission.example/api/impeccable/live')).toContain(
            "window.__IMPECCABLE_ORIGIN__ = \"https://openmission.example/api/impeccable/live\";"
        );
    });
});