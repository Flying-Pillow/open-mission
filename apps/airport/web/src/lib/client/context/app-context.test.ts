import { beforeEach, describe, expect, it } from 'vitest';
import { createAppContext } from '$lib/client/context/app-context.svelte';
import { app } from '$lib/client/Application.svelte';

beforeEach(() => {
    app.reset();
});

describe('createAppContext', () => {
    it('uses the shared application singleton', () => {
        app.reset();
        const context = createAppContext(() => ({
            daemon: {
                running: true,
                startedByHook: false,
                message: 'ready',
                lastCheckedAt: '2026-04-23T19:00:00.000Z',
            },
            githubStatus: 'connected',
        }));

        expect(context.application).toBe(app);
    });

    it('writes active selection ids through the shared application shell state', () => {
        const context = createAppContext(() => ({
            daemon: {
                running: true,
                startedByHook: false,
                message: 'ready',
                lastCheckedAt: '2026-04-23T19:00:00.000Z',
            },
            githubStatus: 'connected',
        }));
        context.setActiveRepository({
            repositoryId: 'repo-1',
            repositoryRootPath: '/repositories/Flying-Pillow/mission',
        });
        context.setActiveMission('mission-29');

        expect(context.airport.activeRepositoryId).toBe('repo-1');
        expect(context.airport.activeRepositoryRootPath).toBe('/repositories/Flying-Pillow/mission');
        expect(context.airport.activeMissionId).toBe('mission-29');
    });

    it('clears the selected mission id when requested', () => {
        const context = createAppContext(() => ({
            daemon: {
                running: true,
                startedByHook: false,
                message: 'ready',
                lastCheckedAt: '2026-04-23T19:00:00.000Z',
            },
            githubStatus: 'connected',
        }));

        context.setActiveMission('mission-29');
        context.setActiveMission(undefined);

        expect(context.airport.activeMissionId).toBeUndefined();
    });
});