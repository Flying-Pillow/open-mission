import { describe, expect, it } from 'vitest';
import { createResponse } from './runDaemonMain.js';

describe('minimal source daemon request handling', () => {
    it('acknowledges event subscriptions so SSE streams can stay open', async () => {
        await expect(createResponse({
            type: 'request',
            id: 'request-1',
            method: 'event.subscribe',
            params: {
                eventTypes: ['mission.status'],
                missionId: 'mission-29'
            }
        }, '2026-04-26T18:05:00.000Z')).resolves.toEqual({
            type: 'response',
            id: 'request-1',
            ok: true,
            result: null
        });
    });

    it.each([
        'mission.terminal.state',
        'mission.terminal.input',
        'session.terminal.state',
        'session.terminal.input'
    ] as const)('returns null for unavailable terminal method %s', async (method) => {
        await expect(createResponse({
            type: 'request',
            id: `request-${method}`,
            method,
            params: {
                selector: { missionId: 'mission-29' },
                sessionId: 'session-1'
            }
        }, '2026-04-26T18:15:00.000Z')).resolves.toEqual({
            type: 'response',
            id: `request-${method}`,
            ok: true,
            result: null
        });
    });
});