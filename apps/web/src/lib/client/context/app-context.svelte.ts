// /apps/web/src/lib/client/context/app-context.svelte.ts: Thin Open Mission app session context; entities live on the app singleton.
import { createContext } from 'svelte';
import { app, type OpenMissionApplication } from '$lib/client/Application.svelte.js';
import type { SystemState } from '@flying-pillow/open-mission-core/entities/System/SystemSchema';

export type GithubStatus = 'connected' | 'disconnected' | 'unknown';

export type AppContextServerValue = {
    daemon: {
        running: boolean;
        message: string;
        endpointPath?: string;
        lastCheckedAt: string;
    };
    githubStatus: GithubStatus;
    systemState?: SystemState;
    user?: {
        name: string;
        email?: string;
        avatarUrl?: string;
        githubStatus: GithubStatus;
    };
};

export type AppContextValue = {
    readonly app: OpenMissionApplication;
    daemon: AppContextServerValue['daemon'];
    githubStatus: GithubStatus;
    user?: AppContextServerValue['user'];
    syncServerContext(next: AppContextServerValue): void;
};

const [getAppContext, setAppContext] = createContext<AppContextValue>();

export { getAppContext, setAppContext };

export function createAppContext(
    initial: AppContextServerValue | (() => AppContextServerValue)
): AppContextValue {
    const initialValue = typeof initial === 'function' ? initial() : initial;
    app.setSystemState(initialValue.systemState);

    const state = $state({
        daemon: initialValue.daemon,
        githubStatus: initialValue.githubStatus,
        user: initialValue.user
    });

    return {
        get app() {
            return app;
        },
        get daemon() {
            return state.daemon;
        },
        get githubStatus() {
            return state.githubStatus;
        },
        get user() {
            return state.user;
        },
        syncServerContext(next) {
            state.daemon = next.daemon;
            state.githubStatus = next.githubStatus;
            state.user = next.user;
            app.setSystemState(next.systemState);
        }
    };
}
